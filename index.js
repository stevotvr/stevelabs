'use strict'

const config = require('./config/config.json');
const schedule = require('./config/schedule.json');
const commands = require('./config/commands.json');
const timers = require('./config/timers.json');

const fs = require('fs');
const tmi = require('tmi.js');

const http = function() {
  if (config.ssl.enabled) {
    const options = {
      key: fs.readFileSync(config.ssl.keyfile),
      cert: fs.readFileSync(config.ssl.cert),
      ca: fs.readFileSync(config.ssl.cafile)
    };

    return require('https').createServer(options, httpHandler);
  } else {
    return require('http').Server(httpHandler);
  }
}();

const io = require('socket.io')(http);

http.listen(config.port, config.host, () => {
  console.log(`listening on ${config.host}:${config.port}`);
});

const client = new tmi.Client({
  connection: {
    secure: true,
    reconnect: true
  },
  identity: {
    username: config.twitch.username,
    password: config.twitch.password
  },
  channels: [ `#${config.twitch.channel}` ]
});

client.connect()
.then(() => {
  console.log('connected to Twitch');
}).catch((err) => {
  console.error(err);
});

const timeouts = {};

let timerPos = 0;
let nextTimer = Date.now() + timers.timeout * 1000;
let chatLines = 0;

for (const k in commands) {
  for (const k2 in commands[k].aliases) {
    commands[commands[k].aliases[k2]] = commands[k];
  }

  timeouts[k] = {
    "global": 0,
    "user": {}
  };
}

client.on('chat', (channel, userstate, message, self) => {
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

  if (Date.now() < Math.max(timeouts[commandName].global, timeouts[commandName].user[userstate.username] || 0)) {
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
      case 'game':
        return 'API REQUEST';
    }
  });

  client.say(channel, response);

  timeouts[commandName].global = Date.now() + command.globalTimeout * 1000;
  timeouts[commandName].user[userstate.username] = Date.now() + command.userTimeout * 1000;
});

setInterval(() => {
  if (chatLines < timers.chatLines || Date.now() < nextTimer) {
    return;
  }

  client.say(config.twitch.channel, timers.messages[timerPos]);
  timerPos = (timerPos + 1) % timers.messages.length;
  nextTimer = Date.now() + timers.timeout * 1000;
  chatLines = 0;
}, 1000);

function httpHandler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/schedule.json') {
    res.writeHead(200).end(JSON.stringify(schedule));
    return;
  }

  res.writeHead(200).end();
}
