/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const nlp = require('./nlp');
const tmi = require('tmi.js');

/**
 * Provides chat functionality.
 */
class ChatBot {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
    this.db = app.db;
    this.nlp = new nlp.Nlp(app);

    this.timerPos = 0;
    this.nextTimer = Infinity;
    this.chatLines = 0;

    this.sessionUsers = new Set();

    this.createChatCommands();
  }

  /**
   * Create the object mapping chat commands.
   */
  createChatCommands() {
    this.chatCommands = {
      say: (user, args, resolve, reject) => {
        resolve(args.join(' '));
      },
      sfx: (user, args, resolve, reject) => {
        if (this.app.sfx[args[0]] === undefined) {
          reject();

          return;
        }

        this.app.http.sendSfx(args[0]);

        resolve();
      },
      tip: (user, args, resolve, reject) => {
        const cb = (err, row) => {
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
        }

        if (args && args[0].match(/\d+/)) {
          this.db.db.get('SELECT id, message FROM tips WHERE id = ?', args[0], cb);
        } else {
          this.db.db.get('SELECT id, message FROM tips ORDER BY RANDOM() LIMIT 1', cd);
        }

      },
      addtip: (user, args, resolve, reject) => {
        const message = args.join(' ');

        if (message.length < 2) {
          reject(`${user} Your tip message is too short (2 characters min, yours was ${message.length})`);
        } else if (message.length > 80) {
          reject(`${user} Your tip message is too long (80 characters max, yours was ${message.length})`);
        } else {
          this.db.db.run('INSERT INTO tips (date, user, message) VALUES (?, ?, ?)', Date.now(), user, message, function (err) {
            if (err) {
              console.warn('error saving tip data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Tip #${this.lastID} has been added to the list`);
          });
        }
      },
      edittip: (user, args, resolve, reject) => {
        if (args.length < 2 || !args[0].match(/\d+/)) {
          reject();
        } else {
          const message = args.slice(1).join(' ').trim();
          this.db.db.run('UPDATE tips SET message = ? WHERE id = ?', message, args[0], err => {
            if (err) {
              console.warn('error saving tip data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Tip #${args[0]} has been edited!`);
          });
        }
      },
      deletetip: (user, args, resolve, reject) => {
        if (args.length < 1 || !args[0].match(/\d+/)) {
          reject();
        } else {
          this.db.db.run('DELETE FROM tips WHERE id = ?', args[0], err => {
            if (err) {
              console.warn('error deleting tip data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Tip #${args[0]} has been deleted!`);
          });
        }
      },
      raffle: (user, args, resolve, reject) => {
        if (!this.app.settings.raffle_active) {
          reject();
        }

        this.db.db.run('INSERT OR IGNORE INTO raffle (user) VALUES (?)', [ user ], err => {
          if (err) {
            console.warn('error saving raffle data');
            console.log(err);

            reject();
          } else {
            resolve(args.join(' '));
          }
        });
      },
      endraffle: (user, args, resolve, reject) => {
        if (!this.app.settings.raffle_active) {
          reject();

          return;
        }

        this.db.db.get('SELECT user FROM raffle ORDER BY RANDOM() LIMIT 1', (err, row) => {
          if (err) {
            console.warn('error retrieving raffle data');
            console.log(err);

            reject();
          } else {
            this.app.settings.raffle_active = false;
            this.app.saveSettings();

            this.app.http.sendAlert('rafflewinner', { user: row.user });
            resolve(row ? args.join(' ').replace('${winner}', row.user) : '');
          }
        });
      },
      startraffle: (user, args, resolve, reject) => {
        if (this.app.settings.raffle_active) {
          reject();

          return;
        }

        this.db.db.get('DELETE FROM raffle', err => {
          if (err) {
            console.warn('error deleting raffle data');
            console.log(err);

            reject();
          } else {
            this.app.settings.raffle_active = true;
            this.app.saveSettings();

            resolve(args.join(' '));
          }
        });
      },
      shoutout: (user, args, resolve, reject) => {
        if (!args[0]) {
          reject();
          return;
        }

        this.app.api.getUser(args[0])
          .then(user => {
            this.app.http.sendAlert('shoutout', {
              user: user.display_name,
              image: user.profile_image_url
            });

            resolve(args.length > 1 ? args.slice(1).join(' ') : null);
          })
          .catch(() => reject());
      },
      quote: (user, args, resolve, reject) => {
        const cb = (err, row) => {
          if (err) {
            console.warn('error getting quote data');
            console.log(err);

            reject();

            return;
          }

          if (row) {
            const date = new Date(row.date);
            const dateString = `${date.getMonth()}/${date.getDate()}/${date.getFullYear()}`;
            const endTag = row.game ? `[${row.game}] [${dateString}]` : `[${dateString}]`;

            const message = row.message[0] === '"' ? row.message : `"${row.message}"`;
            resolve(`Quote #${row.id}: ${message} ${endTag}`);
          } else {
            resolve(`Sorry, ${user}, we're all out of quotes!`);
          }
        };

        if (args && args[0].match(/\d+/)) {
          this.db.db.get('SELECT id, date, game, message FROM quotes WHERE id = ?', args[0], cb);
        } else {
          this.db.db.get('SELECT id, date, game, message FROM quotes ORDER BY RANDOM() LIMIT 1', cb);
        }
      },
      addquote: async (user, args, resolve, reject) => {
        const message = args.join(' ').trim();

        if (!this.app.islive) {
          reject(`${user} You can only add a quote when the channel is live`);
        } else if (message.length < 2) {
          reject(`${user} Your quote message is too short (2 characters min, yours was ${message.length})`);
        } else {
          let game = '';
          try {
            const streamInfo = await this.app.api.getStreamInfo(this.app.settings.twitch_channel_username);
            if (streamInfo) {
              const gameInfo = await this.app.api.getGame(streamInfo.game_id);
              if (gameInfo) {
                game = gameInfo.name;
              }
            }
          } catch (err) {
            console.warn('quote: error getting game info');
            console.log(err);
          }

          this.db.db.run('INSERT INTO quotes (date, user, game, message) VALUES (?, ?, ?, ?)', Date.now(), user, game, message, function (err) {
            if (err) {
              console.warn('error saving quote data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Quote #${this.lastID} has been added!`);
          });
        }
      },
      editquote: (user, args, resolve, reject) => {
        if (args.length < 2 || !args[0].match(/\d+/)) {
          reject();
        } else {
          const message = args.slice(1).join(' ').trim();
          this.db.db.run('UPDATE quotes SET message = ? WHERE id = ?', message, args[0], err => {
            if (err) {
              console.warn('error saving quote data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Quote #${args[0]} has been edited!`);
          });
        }
      },
      deletequote: (user, args, resolve, reject) => {
        if (args.length < 1 || !args[0].match(/\d+/)) {
          reject();
        } else {
          this.db.db.run('DELETE FROM quotes WHERE id = ?', args[0], err => {
            if (err) {
              console.warn('error deleting quote data');
              console.log(err);

              reject();

              return;
            }

            resolve(`Quote #${args[0]} has been deleted!`);
          });
        }
      }
    };
  }

  /**
   * Set up the Twitch chat clients.
   */
  setupTwitchClients() {
    const settings = this.app.settings;
    if (!settings.twitch_channel_username || !settings.twitch_channel_password || !settings.twitch_bot_username || !settings.twitch_bot_password) {
      return;
    }

    // Create the client for the host channel
    this.host = new tmi.Client({
      connection: {
        secure: true,
        reconnect: true
      },
      identity: {
        username: settings.twitch_channel_username,
        password: settings.twitch_channel_password
      },
      channels: [ `${settings.twitch_channel_username}` ]
    });

    this.host.connect()
    .then(() => {
      console.log('connected to Twitch channel');
    }).catch(err => {
      console.warn('failed to connect to Twitch channel');
      console.log(err);
    });

    // Create the client for the bot channel
    this.bot = new tmi.Client({
      connection: {
        secure: true,
        reconnect: true
      },
      identity: {
        username: settings.twitch_bot_username,
        password: settings.twitch_bot_password
      }
    });

    this.bot.connect()
    .then(() => {
      console.log('connected to Twitch bot channel');
    }).catch(err => {
      console.warn('failed to connect to Twitch bot channel');
      console.log(err);
    });

    this.nextTimer = Date.now() + settings.timer_timeout * 1000;

    this.hookEvents();
    this.startTimers();

    const chatbot = this;
    this.host.on('chat', (channel, userstate, message, self) => chatbot.onChat(channel, userstate, message, self));
  }

  /**
   * Set up listeners for channel events.
   */
  hookEvents() {
    const app = this.app;

    // Cheer event
    this.host.on('cheer', (channel, userstate, message) => {
      app.http.sendAlert('cheer', {
        user: userstate['display-name'],
        amount: userstate.bits,
        message: message
      });
    });

    // New subscriber event
    this.host.on('subscription', (channel, username, method, message, userstate) => {
      app.http.sendAlert('subscription', {
        user: userstate['display-name'],
        message: message
      });
    });

    // User renews anonymous gift subscription event
    this.host.on('anongiftpaidupgrade', (channel, username, userstate) => {
      app.http.sendAlert('subscription', {
        user: userstate['display-name']
      });
    });

    // User renews gift subscription event
    this.host.on('giftpaidupgrade', (channel, username, sender, userstate) => {
      app.http.sendAlert('subscription', {
        user: userstate['display-name']
      });
    });

    // User renews subscription event
    this.host.on('resub', (channel, username, months, message, userstate, methods) => {
      app.http.sendAlert('resub', {
        user: userstate['display-name'],
        months: months,
        message: message
      });
    });

    // User gifts subscription to user event
    this.host.on('subgift', (channel, username, streakMonths, recipient, methods, userstate) => {
      app.http.sendAlert('subgift', {
        user: userstate['display-name'],
        recipient: recipient
      });
    });

    // User gifts subscriptions to random users event
    this.host.on('submysterygift', (channel, username, numbOfSubs, methods, userstate) => {
      app.http.sendAlert('submysterygift', {
        user: userstate['display-name'],
        subcount: numbOfSubs
      });
    });

    // Raid event
    this.host.on('raided', (channel, username, viewers) => {
      app.http.sendAlert('raid', {
        user: username,
        viewers: viewers
      });
    });

    // Host event
    this.host.on('hosted', (channel, username, viewers, autohost) => {
      if (autohost) {
        return;
      }

      app.http.sendAlert('host', {
        user: username,
        viewers: viewers
      });
    });
  }

  /**
   * Start the chat timers.
   */
  startTimers() {
    const app = this.app;
    const chatbot = this;

    setInterval(() => {
      if (!app.timers || !app.islive || chatbot.chatLines < app.settings.timer_chat_lines || Date.now() < chatbot.nextTimer) {
        return;
      }

      chatbot.bot.say(app.settings.twitch_channel_username, app.timers[chatbot.timerPos]);
      chatbot.timerPos = (chatbot.timerPos + 1) % app.timers.length;
      chatbot.nextTimer = Date.now() + app.settings.timer_timeout * 1000;
      chatbot.chatLines = 0;
    }, 1000);
  }

  /**
   * Handle a chat message.
   *
   * @param {string} channel The channel that received the message
   * @param {object} userstate Data about the user that sent the message
   * @param {string} message The message text
   * @param {bool} self Whether the message originated from the destination
   */
  onChat(channel, userstate, message, self) {
    if (userstate.username === this.app.settings.twitch_bot_username) {
      return;
    }

    this.chatLines++;

    if (!this.sessionUsers.has(userstate.username) && userstate.badges.broadcaster === undefined) {
      this.sessionUsers.add(userstate.username);

      this.app.db.db.get('SELECT 1 FROM autoshoutout WHERE user = ?', [ userstate.username ], (err, row) => {
        if (row || userstate.badges.subscriber !== undefined || userstate.badges.vip !== undefined) {
          const params = [ userstate.username ];
          if (row && this.app.commands.shoutout) {
            params.push(...this.parseCommand(this.app.commands.shoutout.command, [ null, userstate.username ], userstate).slice(2));
          }

          this.chatCommands.shoutout(null, params, res => {
            if (res) {
              this.bot.say(channel, res);
            }
          }, () => {});
        }
      });
    }

    message = message.trim();

    const first = message.substring(message[0] === '@' ? 1 : 0, message.indexOf(' '));
    const tobot = first.toLowerCase() === this.app.settings.twitch_bot_username.toLowerCase();
    if (tobot && message.indexOf(' ') !== -1) {
      this.nlp.process(message.substring(message.indexOf(' ') + 1))
        .then(answer => this.bot.say(channel, `${userstate['display-name']}, ${answer}`));
    }

    if (message[0] !== '!' && !tobot) {
      return;
    }

    console.log(`${userstate.username}: ${message}`);

    if (message[0] !== '!') {
      return;
    }

    let command = false;
    for (let i = 0; i < this.app.commands._keys.length; i++) {
      const key = this.app.commands._keys[i];
      if (key === message.substr(1, key.length)) {
        command = this.app.commands[key];
        break
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

    const params = message.trim().substring(command.trigger.length + 2).split(/\s+/);
    params.unshift(command.trigger);
    const parsed = this.parseCommand(command.command, params, userstate);
    if (!parsed.length || this.chatCommands[parsed[0]] === undefined) {
      return;
    }

    new Promise((resolve, reject) => {
      this.chatCommands[parsed[0]](userstate.username, parsed.slice(1), resolve, reject);
    })
    .then(response => {
      if (response) {
        this.bot.say(channel, response);
      }

      command.timeouts.global = Date.now() + command.global_timeout * 1000;
      command.timeouts.user[userstate.username] = Date.now() + command.user_timeout * 1000;
    })
    .catch(response => {
      if (response) {
        this.bot.say(channel, response);
      }
    });
  }

  /**
   * Parse a chat command string.
   *
   * @param {string} command The command string
   * @param {array} params The parameters
   * @param {object} userstate The user state of the user triggering the command
   */
  parseCommand(command, params, userstate) {
    let parsed = command.replace(/\$\{(\d+)(\:(\d*))?\}/g, (match, start, range, end) => {
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

    return parsed.split(/\s+/);
  }
}

module.exports.ChatBot = ChatBot;
