/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import ChatClient from 'twitch-chat-client';
import Nlp from './nlp.js';

/**
 * Provides chat functionality.
 */
export default class ChatBot {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
    this.db = app.db.db;
    this.nlp = new Nlp(app);

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
      say: async (user, args) => {
        this.say(args.join(' '));
      },
      sfx: async (user, args) => {
        if (this.app.sfx[args[0]] === undefined) {
          throw 'sound not found';
        }

        this.app.http.sendSfx(args[0]);
      },
      tip: async (user, args) => {
        const cb = (err, row) => {
          if (err) {
            console.warn('error getting tip data');
            console.log(err);

            return;
          }

          if (row) {
            this.say(`TIP #${row.id}: ${row.message}`);
          } else {
            this.say(`Sorry, ${user}, we're all out of tips!`);
          }
        }

        if (args && args[0].match(/\d+/)) {
          this.db.get('SELECT id, message FROM tips WHERE id = ?', args[0], cb);
        } else {
          this.db.get('SELECT id, message FROM tips ORDER BY RANDOM() LIMIT 1', cb);
        }
      },
      addtip: async (user, args) => {
        const message = args.join(' ');

        if (message.length < 2) {
          this.say(`${user} Your tip message is too short (2 characters min, yours was ${message.length})`);
        } else if (message.length > 80) {
          this.say(`${user} Your tip message is too long (80 characters max, yours was ${message.length})`);
        } else {
          const chatbot = this;
          this.db.run('INSERT INTO tips (date, user, message) VALUES (?, ?, ?)', Date.now(), user, message, function (err) {
            if (err) {
              console.warn('error saving tip data');
              console.log(err);

              return;
            }

            chatbot.say(`Tip #${this.lastID} has been added to the list`);
          });
        }
      },
      edittip: async (user, args) => {
        if (args.length < 2 || !args[0].match(/\d+/)) {
          throw 'invalid arguments';
        } else {
          const message = args.slice(1).join(' ').trim();
          this.db.run('UPDATE tips SET message = ? WHERE id = ?', message, args[0], err => {
            if (err) {
              console.warn('error saving tip data');
              console.log(err);

              return;
            }

            this.say(`Tip #${args[0]} has been edited!`);
          });
        }
      },
      deletetip: async (user, args) => {
        if (args.length < 1 || !args[0].match(/\d+/)) {
          throw 'invalid arguments';
        } else {
          this.db.run('DELETE FROM tips WHERE id = ?', args[0], err => {
            if (err) {
              console.warn('error deleting tip data');
              console.log(err);

              return;
            }

            this.say(`Tip #${args[0]} has been deleted!`);
          });
        }
      },
      raffle: async (user, args) => {
        if (!this.app.settings.raffle_active) {
          throw 'raffle not active';
        }

        this.db.run('INSERT OR IGNORE INTO raffle (user) VALUES (?)', [ user ], err => {
          if (err) {
            console.warn('error saving raffle data');
            console.log(err);

            return;
          } else {
            this.say(args.join(' '));
          }
        });
      },
      endraffle: async (user, args) => {
        if (!this.app.settings.raffle_active) {
          throw 'raffle not active';
        }

        this.db.get('SELECT user FROM raffle ORDER BY RANDOM() LIMIT 1', (err, row) => {
          if (err) {
            console.warn('error retrieving raffle data');
            console.log(err);

            return;
          } else {
            this.app.settings.raffle_active = false;
            this.app.saveSettings();

            this.app.http.sendAlert('rafflewinner', { user: row.user });
            this.say(row ? args.join(' ').replace('${winner}', row.user) : '');
          }
        });
      },
      startraffle: async (user, args) => {
        if (this.app.settings.raffle_active) {
          throw 'raffle not active';
        }

        this.db.get('DELETE FROM raffle', err => {
          if (err) {
            console.warn('error deleting raffle data');
            console.log(err);

            return;
          } else {
            this.app.settings.raffle_active = true;
            this.app.saveSettings();

            this.say(args.join(' '));
          }
        });
      },
      shoutout: async (user, args) => {
        if (!args[0]) {
          throw 'invalid arguments';
        }

        const targetUser = await this.app.api.client.kraken.users.getUserByName(args[0]);
        if (targetUser) {
          this.app.http.sendAlert('shoutout', {
            user: targetUser.displayName,
            image: targetUser.logoUrl
          });

          this.say(args.length > 1 ? args.slice(1).join(' ') : null);
        }
      },
      quote: async (user, args) => {
        const cb = (err, row) => {
          if (err) {
            console.warn('error getting quote data');
            console.log(err);

            return;
          }

          if (row) {
            const date = new Date(row.date);
            const dateString = `${date.getMonth()}/${date.getDate()}/${date.getFullYear()}`;
            const endTag = row.game ? `[${row.game}] [${dateString}]` : `[${dateString}]`;

            const message = row.message[0] === '"' ? row.message : `"${row.message}"`;
            this.say(`Quote #${row.id}: ${message} ${endTag}`);
          } else {
            this.say(`Sorry, ${user}, we're all out of quotes!`);
          }
        };

        if (args && args[0].match(/\d+/)) {
          this.db.get('SELECT id, date, game, message FROM quotes WHERE id = ?', args[0], cb);
        } else {
          this.db.get('SELECT id, date, game, message FROM quotes ORDER BY RANDOM() LIMIT 1', cb);
        }
      },
      addquote: async (user, args) => {
        const message = args.join(' ').trim();

        if (!this.app.islive) {
          this.say(`${user} You can only add a quote when the channel is live`);
        } else if (message.length < 2) {
          this.say(`${user} Your quote message is too short (2 characters min, yours was ${message.length})`);
        } else {
          let game = '';
          try {
            const channel = await this.app.api.client.kraken.channels.getMyChannel();
            if (channel) {
              game = channel.game;
            }
          } catch (err) {
            console.warn('quote: error getting game info');
            console.log(err);
          }

          const chatbot = this;
          this.db.run('INSERT INTO quotes (date, user, game, message) VALUES (?, ?, ?, ?)', Date.now(), user, game, message, function (err) {
            if (err) {
              console.warn('error saving quote data');
              console.log(err);

              return;
            }

            chatbot.say(`Quote #${this.lastID} has been added!`);
          });
        }
      },
      editquote: async (user, args) => {
        if (args.length < 2 || !args[0].match(/\d+/)) {
          throw 'invalid arguments';
        } else {
          const message = args.slice(1).join(' ').trim();
          this.db.run('UPDATE quotes SET message = ? WHERE id = ?', message, args[0], err => {
            if (err) {
              console.warn('error saving quote data');
              console.log(err);

              return;
            }

            this.say(`Quote #${args[0]} has been edited!`);
          });
        }
      },
      deletequote: async (user, args) => {
        if (args.length < 1 || !args[0].match(/\d+/)) {
          throw 'invalid arguments';
        } else {
          this.db.run('DELETE FROM quotes WHERE id = ?', args[0], err => {
            if (err) {
              console.warn('error deleting quote data');
              console.log(err);

              return;
            }

            this.say(`Quote #${args[0]} has been deleted!`);
          });
        }
      }
    };
  }

  /**
   * Set up the Twitch chat clients.
   */
  async setupTwitchClients() {
    if (!this.app.api.client || !this.app.api.botClient) {
      return;
    }

    if (this.host) {
      await this.host.quit();
    }

    if (this.bot) {
      await this.bot.quit();
    }

    // Create the client for the host channel
    this.host = ChatClient.forTwitchClient(this.app.api.client, {
      channels: [ this.app.config.users.host ]
    });

    this.host.connect()
    .then(() => {
      console.log('connected to Twitch channel');
    }).catch(err => {
      console.warn('failed to connect to Twitch channel');
      console.log(err);
    });

    // Create the client for the bot channel
    this.bot = ChatClient.forTwitchClient(this.app.api.botClient);

    this.bot.connect()
    .then(() => {
      console.log('connected to Twitch bot channel');
    }).catch(err => {
      console.warn('failed to connect to Twitch bot channel');
      console.log(err);
    });

    this.nextTimer = Date.now() + this.app.settings.timer_timeout * 1000;

    this.hookEvents();
    this.startTimers();

    this.host.onPrivmsg((channel, user, message, msg) => this.onChat(channel, user, message, msg));
  }

  /**
   * Set up listeners for channel events.
   */
  hookEvents() {
    // New subscriber event
    this.host.onSub((channel, user, subInfo, msg) => {
      this.app.http.sendAlert('subscription', {
        user: subInfo.displayName,
        message: subInfo.message
      });
    });

    // User renews anonymous gift subscription event
    this.host.onGiftPaidUpgrade((channel, user, subInfo, msg) => {
      this.app.http.sendAlert('subscription', {
        user: subInfo.displayName
      });
    });

    // User renews subscription event
    this.host.onResub((channel, user, subInfo, msg) => {
      this.app.http.sendAlert('resub', {
        user: subInfo.displayName,
        months: subInfo.months,
        message: subInfo.message
      });
    });

    // User gifts subscription to user event
    this.host.onSubGift((channel, user, subInfo, msg) => {
      this.app.http.sendAlert('subgift', {
        user: subInfo.gifterDisplayName,
        recipient: subInfo.displayName
      });
    });

    // User gifts subscriptions to random users event
    this.host.onCommunitySub((channel, user, subInfo, msg) => {
      this.app.http.sendAlert('submysterygift', {
        user: subInfo.gifterDisplayName,
        subcount: subInfo.count
      });
    });

    // Raid event
    this.host.onRaid((channel, user, raidInfo, msg) => {
      this.app.http.sendAlert('raid', {
        user: raidInfo.displayName,
        viewers: raidInfo.viewerCount
      });
    });

    // Host event
    this.host.onHosted((channel, byChannel, auto, viewers) => {
      if (auto) {
        return;
      }

      this.app.http.sendAlert('host', {
        user: byChannel,
        viewers: viewers
      });
    });
  }

  /**
   * Start the chat timers.
   */
  startTimers() {
    const chatbot = this;

    setInterval(() => {
      if (!chatbot.app.timers || !chatbot.app.islive || chatbot.chatLines < chatbot.app.settings.timer_chat_lines || Date.now() < chatbot.nextTimer) {
        return;
      }

      chatbot.bot.say(chatbot.app.config.users.host, chatbot.app.timers[chatbot.timerPos]);
      chatbot.timerPos = (chatbot.timerPos + 1) % chatbot.app.timers.length;
      chatbot.nextTimer = Date.now() + chatbot.app.settings.timer_timeout * 1000;
      chatbot.chatLines = 0;
    }, 1000);
  }

  /**
   * Handle a cheer from a user.
   *
   * @param {string} user The user that sent the cheer message
   * @param {int} totalBits The total number of bits
   * @param {string} message The cheer message
   */
  onCheer(user, totalBits, message) {
    this.app.http.sendAlert('cheer', {
      user: user,
      amount: totalBits,
      message: message
    });
  }

  /**
   * Handle a chat message.
   *
   * @param {string} channel The channel that received the message
   * @param {string} user The user that sent the message
   * @param {string} message The message text
   * @param {TwitchPrivateMessage} msg The raw message data
   */
  async onChat(channel, user, message, msg) {
    if (user === this.app.config.users.bot) {
      return;
    }

    this.chatLines++;

    if (!this.sessionUsers.has(user) && !msg.userInfo.isBroadcaster) {
      this.sessionUsers.add(user);

      this.app.db.db.get('SELECT 1 FROM autoshoutout WHERE user = ?', [ user ], async (err, row) => {
        if (row || msg.userInfo.isSubscriber || msg.userInfo.isVip) {
          const params = [ user ];
          if (row && this.app.commands.shoutout) {
            params.push(...(await this.parseCommand(this.app.commands.shoutout.command, [ null, user ], msg.userInfo)).slice(2));
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

    if (msg.isCheer) {
      this.onCheer(user, msg.totalBits, message);
      return;
    }

    const first = message.substring(message[0] === '@' ? 1 : 0, message.indexOf(' '));
    const tobot = first.toLowerCase() === this.app.config.users.bot.toLowerCase();
    if (tobot && message.indexOf(' ') !== -1) {
      this.nlp.process(message.substring(message.indexOf(' ') + 1))
        .then(answer => this.bot.say(channel, `${user}, ${answer}`));
    }

    if (message[0] !== '!' && !tobot) {
      return;
    }

    console.log(`${user}: ${message}`);

    if (message[0] !== '!') {
      return;
    }

    let command, alias = false;
    for (let i = 0; i < this.app.commands._keys.length; i++) {
      const key = this.app.commands._keys[i];
      if (key === message.substr(1, key.length)) {
        command = this.app.commands[key];
        alias = key;
        break
      }
    }

    if (!command) {
      return;
    }

    if (Date.now() < Math.max(command.timeouts.global, command.timeouts.user[user] || 0)) {
      return;
    }

    let level = 0;
    if (msg.userInfo.isBroadcaster) {
      level = 3;
    } else if (msg.userInfo.isMod) {
      level = 2;
    } else if (msg.userInfo.isSubscriber) {
      level = 1;
    }

    if (level < command.level) {
      return;
    }

    const params = message.trim().substring(alias.length + 2).split(/\s+/);
    params.unshift(command.trigger);
    const parsed = await this.parseCommand(command.command, params, msg.userInfo);
    if (!parsed.length || this.chatCommands[parsed[0]] === undefined) {
      return;
    }

    this.chatCommands[parsed[0]](user, parsed.slice(1))
      .then(() => {
        command.timeouts.global = Date.now() + command.global_timeout * 1000;
        command.timeouts.user[user] = Date.now() + command.user_timeout * 1000;
      })
      .catch(() => {});
  }

  /**
   * Send a message from the bot to the host channel.
   *
   * @param {string} message The message to send
   */
  say(message) {
    if (typeof message === 'string') {
      this.bot.say(this.app.config.users.host, message);
    }
  }

  /**
   * Parse a chat command string.
   *
   * @param {string} command The command string
   * @param {array} params The parameters
   * @param {ChatUser} userInfo The user data of the user triggering the command
   */
  async parseCommand(command, params, userInfo) {
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

    const promises = [];
    parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, (match, fn, p) => {
      promises.push(new Promise(async (resolve) => {
        switch (fn) {
          case 'user':
            resolve(userInfo.displayName);
            break;
          case 'channel':
            resolve(p.toLowerCase());
            break;
          case 'game':
            if (!p) {
              resolve(this.app.api.game);
              break;
            }

            const user = await this.app.api.client.kraken.users.getUserByName(p);
            if (user) {
              const channel = await user.getChannel();
              if (channel && channel.game) {
                resolve(channel.game);
                break;
              }
            }

            resolve('unknown');
            break;
          default:
            resolve(match);
        }
      }));
    });

    const values = await Promise.all(promises);
    parsed = parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, () => values.shift());

    return parsed.split(/\s+/);
  }
}
