/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

 'use strict'

/**
 * Setup
 */

// User configurations
const alerts = require('./config/alerts.json');
const commands = require('./config/commands.json');
const config = require('./config/config.json');
const schedule = require('./config/schedule.json');
const sfx = require('./config/sfx.json');
const timers = require('./config/timers.json');

// Modules
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const handlebars = require('express-handlebars');
const sqlite3 = require('sqlite3');
const tmi = require('tmi.js');
const { URLSearchParams } = require('url');

// Set up the Express application
const app = express();
app.engine('handlebars', handlebars());
app.set('view engine', 'handlebars');
app.use(express.json({ verify: verifyRequest }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create the HTTP server
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

// Create the socket
const io = require('socket.io')(http);

// Create the database connection
const db = new sqlite3.Database('./data/stovelabs.db', err => {
  if (err) {
    console.warn('database connection failed');
    console.log(err);

    return;
  }

  db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS auth (access_token TEXT, refresh_token TEXT)')
      .run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER, user TEXT, message TEXT)', err => {
        if (err) {
          console.warn('error creating database schema');
          console.log(err);

          return;
        };

        loadAuthConfig();
      });
  });

});

// Start listening to HTTP requests
http.listen(config.port, config.host, () => {
  console.log(`listening on ${config.host}:${config.port}`);
  console.log(`overlay url: ${config.url}/overlay`);
});

// Runtime user configuration
const userData = {
  access_token: '',
  refresh_token: '',
  user_id: 0,
  live: false
};

// Timer variables
let timerPos = 0;
let nextTimer = Date.now() + timers.timeout * 1000;
let chatLines = 0;

// Set up timers
setInterval(() => {
  if (!userData.live || chatLines < timers.chatLines || Date.now() < nextTimer) {
    return;
  }

  bot.say(config.twitch.channel.username, timers.messages[timerPos]);
  timerPos = (timerPos + 1) % timers.messages.length;
  nextTimer = Date.now() + timers.timeout * 1000;
  chatLines = 0;
}, 1000);

// Timeout handles
const whTimeouts = {
  stream: 0,
  follows: 0
};

// Set of processed wenhook notification IDs
const whProcessed = new Set();

// Webhook creation function
const whCreateFuncs = {
  stream: setStreamWebhook,
  follows: setFollowsWebhook
};

// Construct the base URL for the application
config.url = `${config.ssl.enabled ? 'https' : 'http'}://${config.host}:${config.port}`;

// Process the commands configurations
for (const k in commands) {
  for (const k2 in commands[k].aliases) {
    commands[commands[k].aliases[k2]] = commands[k];
  }

  commands[k].timeouts = {
    global: 0,
    user: {}
  };
}

// Process the alerts configurations
for (const key in alerts) {
  const alert = alerts[key];
  if (alert.graphic) {
    const ext = alert.graphic.substring(alert.graphic.lastIndexOf('.') + 1).toLowerCase();
    switch (ext) {
      case 'mp4':
      case 'mov':
      case 'webm':
        alert.video = alert.graphic;
        break;
      default:
        alert.image = alert.graphic;
    }
  }

  alert.message = alert.message.replace(/\$\{([a-z]+)\}/gi, '<span class="$1"></span>');
}

// Create the data directory
try {
  fs.mkdirSync('./data');
} catch {
  // Do nothing; directory probably exists
}

/**
 * Hook HTTP server requests
 */

 // Index page; shows the Twitch auth link
app.get('/', (req, res) => {
  const params = {};
  if (userData.access_token) {
    if (config.debug) {
      params.alerts = alerts;
    }
  } else {
    params.connectUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${config.twitch.api.client}&redirect_uri=${config.url}/cb&response_type=code&scope=user:read:email`;
  }

  res.render('index', params);
});

// The Twitch auth callback
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
        checkStream();
      }
    });
  })
  .catch(err => {
    console.warn('failed to authenticate with Twitch');
    console.log(err);
  })
  .finally(() => res.redirect('/'));
});

// The webhook registration callback
app.get('/wh/:cb', (req, res) => {
  if (req.query['hub.challenge'] && req.query['hub.mode']) {
    console.log(`${req.params.cb} webhook subscription ${req.query['hub.mode']}ed successfully`);
    if (req.query['hub.mode'] === 'subscribe') {
      if (req.query['hub.lease_seconds']) {
        whTimeouts[req.params.cb] = setTimeout(whCreateFuncs[req.params.cb], req.query['hub.lease_seconds'] * 1000);
      }
    } else {
      clearTimeout(whTimeouts[req.params.cb]);
    }

    res.send(req.query['hub.challenge']);
  }
});

// The webhook callback
app.post('/wh/:cb', (req, res) => {
  if (!req.verified) {
    res.sendStatus(403).end();
    return;
  }

  if (!req.headers['twitch-notification-id'] || whProcessed.has(req.headers['twitch-notification-id'])) {
    req.end();
    return;
  }

  switch (req.params.cb) {
    case 'stream':
      userData.live = req.body.data && req.body.data.length > 0;
      console.log(`channel is ${userData.live ? 'LIVE!' : 'offline'}`);

      break;
    case 'follows':
      if (req.body.data) {
        for (let i = req.body.data.length - 1; i >= 0; i--) {
          sendAlert('follower', {
            user: req.body.data[i].from_name
          });
        };
      }

      break;
  }

  whProcessed.add(req.headers['twitch-notification-id']);

  res.end();
});

// The overlay page
app.get('/overlay', (req, res) => {
  const options = {
    layout: false,
    config: { }
  };

  if (req.query.alerts) {
    options.alerts = alerts;
    options.config.alerts = true;
    options.config.donordrive = {
      instance: config.donordrive.instance,
      participant: config.donordrive.participant,
      alertduration: alerts.charitydonation.duration * 1000
    };
  }

  if (req.query.countdown) {
    options.countdown = true;
    options.config.schedule = schedule;
  }

  if (req.query.nextstream) {
    options.nextstream = true;
    options.config.schedule = schedule;
  }

  if (req.query.sfx) {
    options.sfx = sfx;
    options.config.sfx = true;
  }

  new Promise((resolve, reject) => {
    if (req.query.tips) {
      options.config.tips = [];
      options.tips = true;
      db.all('SELECT message FROM tips ORDER BY RANDOM() LIMIT 50', (err, rows) => {
        if (err) {
          console.warn('error loading tip data');
          console.log(err);

          return;
        }

        rows.forEach(row => {
          options.config.tips.push(row.message);
        });

        resolve();
      });
    } else {
      resolve();
    }
  })
  .then(() => {
    options.config = JSON.stringify(options.config);
    res.render('overlay', options);
  });
});

// The form action for the test buttons
app.post('/test', (req, res) => {
  if (!config.debug) {
    res.sendStatus(403).end();
    return;
  }

  if (req.body.alert) {
    sendAlert(req.body.type, req.body);
  }

  res.redirect('/');
});

/**
 * Twitch chat client setup
 */

// Create the client that listens to the stream channel
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

// Connect to the channel
host.connect()
.then(() => {
  console.log('connected to Twitch channel');
}).catch(err => {
  console.warn('failed to connect to Twitch channel');
  console.log(err);
});

// Create the client that sends messages via the bot user
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

// Connect to the bot
bot.connect()
.then(() => {
  console.log('connected to Twitch bot channel');
}).catch(err => {
  console.warn('failed to connect to Twitch bot channel');
  console.log(err);
});

/**
 * Hook channel events
 */

// Chat command functions
const chatCommands = {
  say: (user, args, resolve, reject) => {
    resolve(args.join(' '));
  },
  sfx: (user, args, resolve, reject) => {
    if (sfx[args[0]] === undefined) {
      reject();

      return;
    }

    io.emit('sfx', args[0]);

    resolve();
  },
  tip: (user, args, resolve, reject) => {
    db.get('SELECT id, message FROM tips ORDER BY RANDOM() LIMIT 1', (err, row) => {
      if (err) {
        console.warn('error getting tip data');
        console.log(err);

        reject();

        return;
      }

      if (row) {
        resolve(`TIP #${row.id}: ${row.message}`);
      } else {
        resolve(`Sorry, ${user}, we're all out of tips!`);
      }
    });
  },
  addtip: (user, args, resolve, reject) => {
    const message = args.join(' ');

    if (message.length < 2) {
      reject(`${user} Your tip message is too short (2 characters min, yours was ${message.length})`);
    } else if (message.length > 80) {
      reject(`${user} Your tip message is too long (80 characters max, yours was ${message.length})`);
    } else {
      db.run('INSERT INTO tips (date, user, message) VALUES (?, ?, ?)', Date.now(), user, message, function (err) {
        if (err) {
          console.warn('error saving tip data');
          console.log(err);

          reject();

          return;
        }

        resolve(`Tip #${this.lastID} has been added to the list`);
      });
    }
  }
}

// Chat message
host.on('chat', (channel, userstate, message, self) => {
  if (userstate.username === config.twitch.bot.username) {
    return;
  }

  chatLines++;

  if (message[0] !== '!') {
    return;
  }

  console.log(`${userstate.username}: ${message}`);

  let command = false;
  for (const key in commands) {
    if (key === message.substr(1, key.length)) {
      command = commands[key];
    }
  }

  if (!command) {
    return;
  }

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
  let parsed = command.command.replace(/\$\{(\d+)(\:(\d*))?\}/g, (match, start, range, end) => {
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

  parsed = parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, (match, fn, p) => {
    switch (fn) {
      case 'user':
        return userstate['display-name'];
      case 'channel':
        return p.toLowerCase();
      default:
        return match;
    }
  });

  parsed = parsed.split(/\s+/);
  if (!parsed.length || chatCommands[parsed[0]] === undefined) {
    return;
  }

  new Promise((resolve, reject) => {
    chatCommands[parsed[0]](userstate.username, parsed.slice(1), resolve, reject);
  })
  .then(response => {
    if (response.length) {
      bot.say(channel, response);
    }

    command.timeouts.global = Date.now() + command.globalTimeout * 1000;
    command.timeouts.user[userstate.username] = Date.now() + command.userTimeout * 1000;
  })
  .catch(response => {
    if (response.length) {
      bot.say(channel, response);
    }
  });
});

// Cheer event
host.on('cheer', (channel, userstate, message) => {
  sendAlert('cheer', {
    user: userstate['display-name'],
    amount: userstate.bits,
    message: message
  });
});

// New subscriber event
host.on('subscription', (channel, username, method, message, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name'],
    message: message
  });
});

// User renews anonymous gift subscription event
host.on('anongiftpaidupgrade', (channel, username, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name']
  });
});

// User renews gift subscription event
host.on('giftpaidupgrade', (channel, username, sender, userstate) => {
  sendAlert('subscription', {
    user: userstate['display-name']
  });
});

// User renews subscription event
host.on('resub', (channel, username, months, message, userstate, methods) => {
  sendAlert('resub', {
    user: userstate['display-name'],
    months: months,
    message: message
  });
});

// User gifts subscription to user event
host.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
  sendAlert('subgift', {
    user: userstate['display-name'],
    recipient: recipient
  });
});

// User gifts subscriptions to random users event
host.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
  sendAlert('submysterygift', {
    user: userstate['display-name'],
    subcount: numbOfSubs
  });
});

// Raid event
host.on('raided', (channel, username, viewers) => {
  sendAlert('raid', {
    user: username,
    viewers: viewers
  });
});

// Host event
host.on('hosted', (channel, username, viewers, autohost) => {
  if (autohost) {
    return;
  }

  sendAlert('host', {
    user: username,
    viewers: viewers
  });
});

/**
 * Functions
 */

/**
 * Send a new alert to the overlay page.
 *
 * @param {string} type The type of alert to send
 * @param {object} params The alert parameters
 */
function sendAlert(type, params) {
  const alert = alerts[type];

  if ((!alert.message && !alert.graphic && !alert.sound) || !alert.duration) {
    return;
  }

  const duration = Math.max(1, alert.duration) * 1000;

  io.emit('alert', type, params, duration);
  console.log(`alert sent: ${type}`);
}

/**
 * Query the Twitch API.
 *
 * @param {string} url The URL to query
 * @param {string} method GET or POST
 * @param {object} body Object to send as the JSON body
 */
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

              options.headers['Authorization'] = `Bearer ${userData.access_token}`;

              fetch(url, options)
              .then(res => resolve(res));
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

/**
 * Create or destroy all webhooks.
 *
 * @param {bool} enable Whether to enable the webhooks
 */
function setWebhooks(enable = true) {
  setStreamWebhook(enable);
  setFollowsWebhook(enable);
}

/**
 * Create or destroy the stream webhook.
 * This webhook notifies us of changes to the stream.
 *
 * @param {bool} enable Whether to enable the webhook
 */
function setStreamWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/streams?user_id=${userData.user_id}`, 'stream', enable);

  if (!enable) {
    clearTimeout(streamWhTimeout);
  }
}

/**
 * Create or destroy the follows webhook.
 * This webhook notifies us of new followers.
 *
 * @param {bool} enable Whether to enable the webhook
 */
function setFollowsWebhook(enable = true) {
  setWebhook(`https://api.twitch.tv/helix/users/follows?first=1&to_id=${userData.user_id}`, 'follows', enable);

  if (!enable) {
    clearTimeout(followWhTimeout);
  }
}

/**
 * Subscribe or unsubscribe to a Twitch webhook.
 *
 * @param {string} topic The topic to which to subscribe or unsubscribe
 * @param {string} cb The name of the callback
 * @param {bool} enable Whether to enable the webhook
 */
function setWebhook(topic, cb, enable) {
  apiRequest('https://api.twitch.tv/helix/webhooks/hub', 'POST', {
    'hub.callback': `${config.url}/wh/${cb}`,
    'hub.mode': enable ? 'subscribe' : 'unsubscribe',
    'hub.topic': topic,
    'hub.lease_seconds': 86400,
    'hub.secret': config.secret
  })
  .catch(err => {
    console.warn(`failed to ${enable ? 'create' : 'destroy'} stream webhook subscription`);
    console.log(err);
  });
}

/**
 * Save the Twitch authentication tokens to disk.
 */
function saveAuthConfig() {
  db.serialize(() => {
    db.run('DELETE FROM auth')
      .run('INSERT INTO auth (access_token, refresh_token) VALUES (?, ?)', userData.access_token, userData.refresh_token, err => {
        if (err) {
          console.warn('error saving auth configuration');
          console.log(err);

          return;
        }

        console.log('auth configuration saved successfully');
      });
  });
}

/**
 * Load the Twitch authentication tokens from disk.
 */
function loadAuthConfig() {
  db.get('SELECT * FROM auth', (err, row) => {
    if (err) {
      console.log('error loading auth configuration');
      console.log(err);
      return;
    }

    if (row) {
      userData.access_token = row.access_token;
      userData.refresh_token = row.refresh_token;

      checkUser()
      .then(valid => {
        if (valid) {
          setWebhooks();
          checkStream();
        } else {
          console.log('invalid oauth2 tokens');
        }
      });
    }
  });
}

/**
 * Verify authentication tokens and load user data.
 */
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

/**
 * Update the current status of the stream.
 */
function checkStream() {
  if (!userData.user_id) {
    return;
  }

  apiRequest(`https://api.twitch.tv/helix/streams?user_id=${userData.user_id}`, 'GET')
  .then(res => res.json())
  .then(chan => {
    userData.live = chan.data && chan.data.length > 0;
    console.log(`channel is ${userData.live ? 'LIVE!' : 'offline'}`);
  })
  .catch(err => {
    console.warn('api request for channel data failed');
    console.log(err);
  });
}

/**
 * Verify a signed request.
 *
 * @param {express.Request} req The request object
 * @param {express.response} res The response object
 * @param {Buffer} buf Buffer containing the raw request body
 * @param {string} encoding The encoding of the request
 */
function verifyRequest(req, res, buf, encoding) {
  req.verified = false;
  if (req.headers['x-hub-signature']) {
    const hash = crypto.createHmac('sha256', config.secret).update(buf).digest('hex');
    req.verified = req.headers['x-hub-signature'] === `sha256=${hash}`;
  }
}
