'use strict'

const config = require('./config/config.json');
const schedule = require('./config/schedule.json');
const commands = require('./config/commands.json');
const timers = require('./config/timers.json');
const alerts = require('./config/alerts.json');

const fs = require('fs');
const tmi = require('tmi.js');
const express = require('express');
const fetch = require('node-fetch');
const handlebars = require('express-handlebars');
const { URLSearchParams } = require('url');

const app = express();
app.engine('handlebars', handlebars());
app.set('view engine', 'handlebars');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const http = function() {
  if (config.ssl.enabled) {
    const options = {
      key: fs.readFileSync(config.ssl.keyfile),
      cert: fs.readFileSync(config.ssl.cert),
      ca: fs.readFileSync(config.ssl.cafile)
    };

    return require('https').createServer(options, app);
  } else {
    return require('http').Server(app);
  }
}();

const io = require('socket.io')(http);

const userData = {
  access_token: '',
  refresh_token: '',
  user_id: 0,
  live: false
};

let streamWhTimeout = 0;
let followWhTimeout = 0;

config.url = `${config.ssl.enabled ? 'https' : 'http'}://${config.host}:${config.port}`;

for (const key in alerts) {
  const alert = alerts[key];
  alert.message = alert.message.replace(/\$\{([a-z]+)\}/gi, '<span class="$1"></span>');
}

try {
  fs.mkdirSync('./data');
} catch {}

loadAuthConfig();

app.get('/', (req, res) => {
  if (userData.access_token) {
    res.render('index');
  } else {
    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${config.twitch.api.client}&redirect_uri=${config.url}/cb&response_type=code&scope=user:read:email`;
    res.render('index', { connectUrl: url });
  }
});

app.get('/schedule.json', (req, res) => {
  res.set('Content-Type', 'application/json');
  res.set('Access-Control-Allow-Origin', '*');
  res.send(JSON.stringify(schedule));
});

app.get('/cb', (req, res) => {
  if (!req.query.code) {
    res.status(400).end();
    return;
  }

  const url = `https://id.twitch.tv/oauth2/token?client_id=${config.twitch.api.client}&client_secret=${config.twitch.api.secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${config.url}/cb`;

  fetch(url, {
    method: 'POST'
  })
  .then(res => res.json())
  .then(auth => {
    userData.access_token = auth.access_token;
    userData.refresh_token = auth.refresh_token;
    checkUser()
    .then(valid => {
      if (valid) {
        saveAuthConfig();
        setWebhooks();
      }
    });
  })
  .catch(err => {
    console.warn('failed to authenticate with Twitch');
    console.log(err);
  })
  .finally(() => res.redirect('/'));
});

app.get('/wh/stream', (req, res) => {
  if (req.query['hub.challenge'] && req.query['hub.mode']) {
    console.log(`stream webhook subscription ${req.query['hub.mode']}ed successfully`);
    if (req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.lease_seconds']) {
        streamWhTimeout = setTimeout(setStreamWebhook, req.query['hub.lease_seconds'] * 1000);
      }
    } else {
      clearTimeout(streamWhTimeout);
    }

    res.send(req.query['hub.challenge']);
  }
});

app.post('/wh/stream', (req, res) => {
  userData.live = req.body.data.length > 0;
  console.log(`channel is ${userData.live ? 'LIVE!' : 'offline'}`);
  res.end();
});

app.get('/wh/follows', (req, res) => {
  if (req.query['hub.challenge'] && req.query['hub.mode']) {
    console.log(`follows webhook subscription ${req.query['hub.mode']}ed successfully`);
    if (req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.lease_seconds']) {
        followWhTimeout = setTimeout(setFollowsWebhook, req.query['hub.lease_seconds'] * 1000);
      }
    } else {
      clearTimeout(followWhTimeout);
    }

    res.send(req.query['hub.challenge']);
  }
});

app.post('/wh/follows', (req, res) => {
  sendAlert('follower', {
    user: req.body.data[0].from_name
  });
  res.end();
});

app.get('/overlay', (req, res) => {
  res.render('overlay', { layout: false, alerts: alerts });
});

app.post('/test', (req, res) => {
  if (req.body.alert) {
    sendAlert(req.body.type, req.body);
  }

  res.redirect('/');
});

http.listen(config.port, config.host, () => {
  console.log(`listening on ${config.host}:${config.port}`);
  console.log(`overlay url: ${config.url}/overlay`);
});

const host = new tmi.Client({
  connection: {
    secure: true,
    reconnect: true
  },
  identity: {
    username: config.twitch.channel.username,
    password: config.twitch.channel.password
  },
  channels: [ `#${config.twitch.channel.username}` ]
});

host.connect()
.then(() => {
  console.log('connected to Twitch channel');
}).catch(err => {
  console.warn('failed to connect to Twitch channel');
  console.log(err);
});

const bot = new tmi.Client({
  connection: {
    secure: true,
    reconnect: true
  },
  identity: {
    username: config.twitch.bot.username,
    password: config.twitch.bot.password
  }
});

bot.connect()
.then(() => {
  console.log('connected to Twitch bot channel');
}).catch(err => {
  console.warn('failed to connect to Twitch bot channel');
  console.log(err);
});

let timerPos = 0;
let nextTimer = Date.now() + timers.timeout * 1000;
let chatLines = 0;

for (const k in commands) {
  for (const k2 in commands[k].aliases) {
    commands[commands[k].aliases[k2]] = commands[k];
  }

  commands[k].timeouts = {
    global: 0,
    user: {}
  };
}

host.on('chat', (channel, userstate, message, self) => {
  if (userstate.username === config.twitch.bot.username) {
    return;
  }

  chatLines++;

  if (message[0] !== '!') {
    return;
  }

  console.log(`${userstate.username}: ${message}`);

  const brk = message.indexOf(' ');
  const commandName = message.substring(1, brk === -1 ? undefined : brk);

  if (commands[commandName] === undefined) {
    return;
  }

  const command = commands[commandName];

  if (Date.now() < Math.max(command.timeouts.global, command.timeouts.user[userstate.username] || 0)) {
    return;
  }

  let level = 0;
  if (`#${userstate.username}` === channel) {
    level = 3;
  } else if (userstate.mod) {
    level = 2;
  } else if (userstate.subscriber) {
    level = 1;
  }

  if (level < command.level) {
    return;
  }

  const params = message.trim().substring(1).split(/\s+/);
  let response = command.message.replace(/\$\{(\d+)(\:(\d*))?\}/g, (match, start, range, end) => {
    if (range) {
      if (end) {
        if (end >= 0) {
          end++;
        }

        return params.slice(start, end).join(' ');
      }

      return params.slice(start).join(' ');
    }

    return params[start];
  });

  response = response.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, (match, fn, p) => {
    switch (fn) {
      case 'user':
        return userstate['display-name'];
      case 'channel':
        return p.toLowerCase();
      default:
        return match;
    }
  });

  bot.say(channel, response);

  command.timeouts.global = Date.now() + command.globalTimeout * 1000;
  command.timeouts.user[userstate.username] = Date.now() + command.userTimeout * 1000;
});

host.on('cheer', (channel, userstate, message) => {
  sendAlert('cheer', {
    user: userstate['display-name'],
    message: message,
  });
});

host.on('subscription', (channel, username, method, message, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name']
  });
});

host.on('anongiftpaidupgrade', (channel, username, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name']
  });
});

host.on('giftpaidupgrade', (channel, username, sender, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name']
  });
});

host.on('resub', (channel, username, months, message, userstate, methods) => {
  sendAlert('resub', {
    user: userstate['display-name'],
    months: months
  });
});

host.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
  sendAlert('subgift', {
    user: userstate['display-name'],
    recipient: recipient
  });
});

host.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
  sendAlert('submysterygift', {
    user: userstate['display-name'],
    subcount: numbOfSubs
  });
});

host.on('raided', (channel, username, viewers) => {
  sendAlert('raid', {
    user: username,
    viewers: viewers
  });
});

host.on('hosted', (channel, username, viewers, autohost) => {
  if (autohost) {
    return;
  }

  sendAlert('host', {
    user: username,
    viewers: viewers
  });
});

setInterval(() => {
  if (!userData.live || chatLines < timers.chatLines || Date.now() < nextTimer) {
    return;
  }

  bot.say(config.twitch.channel.username, timers.messages[timerPos]);
  timerPos = (timerPos + 1) % timers.messages.length;
  nextTimer = Date.now() + timers.timeout * 1000;
  chatLines = 0;
}, 1000);

function sendAlert(type, params) {
  const alert = alerts[type];

  if ((!alert.message && !alert.graphic && !alert.sound) || !alert.duration) {
    return;
  }

  const duration = Math.max(1, alert.duration) * 1000;

  io.emit('alert', type, params, duration);
  console.log(`alert sent: ${type}`);
}

function apiRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    if (!userData.access_token) {
      reject('api request failed due to missing access token');
      return;
    }

    const options =  {
      method: method,
      headers: {
        'Client-ID': config.twitch.api.client,
        'Authorization': `Bearer ${userData.access_token}`
      }
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    fetch(url, options)
      .then(res => {
        if (res.status === 401) {
          if (!userData.refresh_token) {
            reject('api request failed due to invalid or expired access token');
            return;
          }

          fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: userData.refresh_token,
              client_id: config.twitch.api.client,
              client_secret: config.twitch.api.secret
            })
          })
          .then(res => res.json())
          .then(json => {
            if (json.access_token) {
              userData.access_token = json.access_token;
              userData.refresh_token = json.refresh_token;

              saveAuthConfig();

              resolve(res);
            } else {
              userData.access_token = '';
              userData.refresh_token = '';

              reject('failed to refresh token');
            }
          });
        } else {
          resolve(res);
        }
      })
      .catch(reject);
  });
}

function setWebhooks(enable = true) {
  setStreamWebhook(enable);
  setFollowsWebhook(enable);
}

function setStreamWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/streams?user_id=${userData.user_id}`, 'stream', enable);

  if (!enable) {
    clearTimeout(streamWhTimeout);
  }
}

function setFollowsWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/users/follows?first=1&to_id=${userData.user_id}`, 'follows', enable);

  if (!enable) {
    clearTimeout(followWhTimeout);
  }
}

function setWebhook(topic, cb, enable) {
  apiRequest('https://api.twitch.tv/helix/webhooks/hub', 'POST', {
    'hub.callback': `${config.url}/wh/${cb}`,
    'hub.mode': enable ? 'subscribe' : 'unsubscribe',
    'hub.topic': topic,
    'hub.lease_seconds': 86400
  })
  .catch(err => {
    console.warn(`failed to ${enable ? 'create' : 'destroy'} stream webhook subscription`);
    console.log(err);
  });
}

function saveAuthConfig() {
  const data = JSON.stringify({
    access_token: userData.access_token,
    refresh_token: userData.refresh_token
  });

  fs.writeFile('./data/auth.json', data, err => {
    if (err) {
      console.warn('error saving auth configuration');
      console.log(err.message);
      return;
    }

    console.log('auth configuration saved successfully');
  })
}

function loadAuthConfig() {
  try {
    const data = fs.readFileSync('./data/auth.json');
    try {
      const auth = JSON.parse(data);
      if (auth.access_token && auth.refresh_token) {
        userData.access_token = auth.access_token;
        userData.refresh_token = auth.refresh_token;

        checkUser()
        .then(valid => {
          if (valid) {
            setWebhooks();
          } else {
            console.log('invalid oauth2 tokens');
          }
        });
      }
    } catch (err) {
      console.log('error loading auth configuration');
      console.log(err);
    }
  } catch {}
}

function checkUser() {
  return new Promise((resolve, reject) => {
    if (!userData.access_token) {
      resolve(false);
      return;
    }

    apiRequest('https://api.twitch.tv/helix/users', 'GET')
    .then(res => res.json())
    .then(user => {
      if (user.data && user.data[0] && user.data[0].login === config.twitch.channel.username) {
        userData.user_id = user.data[0].id;

        console.log(`authenticated with Twitch as user ${config.twitch.channel.username}`);

        resolve(true);
      } else {
        userData.access_token = '';
        userData.refresh_token = '';
        userData.user_id = 0;

        resolve(false);
      }
    })
    .catch(err => {
      console.warn('api request for user data failed');
      console.log(err);
      resolve(false);
    });
  });
}
