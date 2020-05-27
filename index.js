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

const app = express();

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
  expires: 0,
  refresh_token: '',
  user_id: 0,
  live: false,
};

config.redirect = `${config.ssl.enabled ? 'https' : 'http'}://${config.host}:${config.port}/cb`;

app.get('/', (req, res) => {
  if (userData.access_token) {
    res.send('Connected');
  } else {
    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${config.twitch.api.client}&redirect_uri=${config.redirect}&response_type=code&scope=user:read:email`;
    res.send(`<html><body><a href="${url}">Connect</a></body></html>`);
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

  const url = `https://id.twitch.tv/oauth2/token?client_id=${config.twitch.api.client}&client_secret=${config.twitch.api.secret}&code=${req.query.code}&grant_type=authorization_code&redirect_uri=${config.redirect}`;

  fetch(url, {
    method: 'POST'
  })
  .then(res => res.json())
  .then((auth) => {
    userData.access_token = auth.access_token;
    apiRequest('https://api.twitch.tv/helix/users', 'GET', (user) => {
      if (user.data && user.data[0] && user.data[0].login === config.twitch.channel.username) {
        userData.expires = Date.now() + auth.expires_in * 1000;
        userData.refresh_token = auth.refresh_token;
        userData.user_id = user.data[0].id;
      } else {
        userData.access_token = '';
      }

      res.redirect('/');
    });
  });
});

app.listen(config.port, config.host, () => {
  console.log(`listening on ${config.host}:${config.port}`);
});

const host = new tmi.Client({
  connection: {
    secure: true,
    reconnect: true
  },
  identity: {
    username: config.twitch.channel.username,
    password: config.twitch.channel.password
  }
});

host.connect()
.then(() => {
  console.log('connected to Twitch channel');
}).catch((err) => {
  console.error(err);
});

const bot = new tmi.Client({
  connection: {
    secure: true,
    reconnect: true
  },
  identity: {
    username: config.twitch.bot.username,
    password: config.twitch.bot.password
  },
  channels: [ `#${config.twitch.channel.username}` ]
});

bot.connect()
.then(() => {
  console.log('connected to Twitch bot channel');
}).catch((err) => {
  console.error(err);
});

let timerPos = 0;
let nextTimer = Date.now() + timers.timeout * 1000;
let chatLines = 0;

for (const k in commands) {
  for (const k2 in commands[k].aliases) {
    commands[commands[k].aliases[k2]] = commands[k];
  }

  commands[k].timeouts = {
    "global": 0,
    "user": {}
  };
}

bot.on('chat', (channel, userstate, message, self) => {
  if (self) {
    return;
  }

  chatLines++;

  if (message[0] !== '!') {
    return;
  }

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
    "user": userstate['display-name'],
    "message": message,
  });
});

host.on('subscription', (channel, username, method, message, userstate) => {
  sendAlert('subscription', {
    "user": userstate['display-name']
  });
});

host.on('anongiftpaidupgrade', (channel, username, userstate) => {
  sendAlert('subscription', {
    "user": userstate['display-name']
  });
});

host.on('giftpaidupgrade', (channel, username, sender, userstate) => {
  sendAlert('subscription', {
    "user": userstate['display-name']
  });
});

host.on('resub', (channel, username, months, message, userstate, methods) => {
  sendAlert('resub', {
    "user": userstate['display-name'],
    "months": months
  });
});

host.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
  sendAlert('subgift', {
    "user": userstate['display-name'],
    "recipient": recipient
  });
});

host.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
  sendAlert('submysterygift', {
    "user": userstate['display-name'],
    "subcount": numbOfSubs
  });
});

host.on('raided', (channel, username, viewers) => {
  sendAlert('raid', {
    "user": username,
    "viewers": viewers
  });
});

host.on('hosted', (channel, username, viewers, autohost) => {
  if (autohost) {
    return;
  }

  sendAlert('host', {
    "user": username,
    "viewers": viewers
  });
});

setInterval(() => {
  if (chatLines < timers.chatLines || Date.now() < nextTimer) {
    return;
  }

  bot.say(config.twitch.channel.username, timers.messages[timerPos]);
  timerPos = (timerPos + 1) % timers.messages.length;
  nextTimer = Date.now() + timers.timeout * 1000;
  chatLines = 0;
}, 1000);

function sendAlert(type, params) {
  const alert = alerts[type];

  if (!alert.message && !alert.graphic && !alert.sound) {
    return;
  }

  let message = alert.message;
  if (alert.message) {
    for (const key in params) {
      message = message.replace(`\${${key}}`, params[key]);
    }
  }

  io.emit('alert', message, alert.graphic, alert.sound);
}

function apiRequest(url, method, cb) {
  if (!userData.access_token) {
    return;
  }

  fetch(url, {
    method: method,
    headers: {
      'Client-ID': config.twitch.api.client,
      'Authorization': `Bearer ${userData.access_token}`
    }
  })
  .then(res => res.json())
  .then(json => cb(json));
}
