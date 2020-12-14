/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import { ChatClient } from 'twitch-chat-client';
import nlp from 'node-nlp';

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

    this.nlp = new nlp.NlpManager({ languages: ['en'] });
    this.nlp.load('./data/model.nlp');

    this.timerPos = 0;
    this.nextTimer = Infinity;
    this.chatLines = 0;

    this.sessionUsers = new Set();

    this.triggers = { _keys: [] };
    this.timers = [];
  }

  /**
   * Load the chat triggers from the database.
   */
  loadTriggers() {
    this.db.all('SELECT key, level, user_timeout, global_timeout, aliases, command FROM triggers', (err, rows) => {
      if (err) {
        console.warn('error loading triggers from the database');
        console.log(err);

        return;
      }

      const triggers = { _keys: [] };
      rows.forEach((row) => {
        triggers[row.key] = {
          trigger: row.key,
          level: row.level,
          user_timeout: row.user_timeout,
          global_timeout: row.global_timeout,
          aliases: row.aliases ? row.aliases.split(',') : [],
          command: row.command
        };

        triggers._keys.push(row.key);
      });

      for (const k in triggers) {
        for (const k2 in triggers[k].aliases) {
          triggers[triggers[k].aliases[k2]] = triggers[k];
          triggers._keys.push(triggers[k].aliases[k2]);
        }

        triggers[k].timeouts = {
          global: 0,
          user: {}
        };
      }

      triggers._keys.sort((a, b) => b.length - a.length);

      this.triggers = triggers;
    });
  }

  /**
   * Load the timers from the database.
   */
  loadTimers() {
    this.db.all('SELECT command FROM timers ORDER BY pos', (err, rows) => {
      if (err) {
        console.warn('error loading timers from the database');
        console.log(err);

        return;
      }

      const timers = [];
      rows.forEach((row) => timers.push(row.command));

      this.timers = timers;
    });
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
    this.host = new ChatClient(this.app.api.client, {
      channels: [ this.app.config.users.host ]
    });

    this.host.connect()
    .then(() => {
      console.log('connected to Twitch channel');
    }).catch((err) => {
      console.warn('failed to connect to Twitch channel');
      console.log(err);
    });

    // Create the client for the bot channel
    this.bot = new ChatClient(this.app.api.botClient);

    this.bot.connect()
    .then(() => {
      console.log('connected to Twitch bot channel');
    }).catch((err) => {
      console.warn('failed to connect to Twitch bot channel');
      console.log(err);
    });

    this.nextTimer = Date.now() + this.app.settings.timer_timeout * 1000;

    this.hookEvents();
    this.startTimers();

    this.host.onMessage((channel, user, message, msg) => this.onChat(channel, user, message, msg));
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
      if (!chatbot.timers.length || !chatbot.app.islive || chatbot.chatLines < chatbot.app.settings.timer_chat_lines || Date.now() < chatbot.nextTimer) {
        return;
      }

      chatbot.app.commands.parseCommand(chatbot.timers[chatbot.timerPos], [], null);
      chatbot.timerPos = (chatbot.timerPos + 1) % chatbot.timers.length;
      chatbot.nextTimer = Date.now() + chatbot.app.settings.timer_timeout * 1000;
      chatbot.chatLines = 0;
    }, 30000);
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

    this.app.stats.addUserChat(user);
    this.app.commands.answerTrivia(user, [ message ]);

    if (!this.sessionUsers.has(user) && !msg.userInfo.isBroadcaster) {
      this.sessionUsers.add(user);

      this.app.db.db.get('SELECT 1 FROM autogreet WHERE user = ?', [ user ], async (err, row) => {
        if (row || msg.userInfo.isSubscriber || msg.userInfo.isVip) {
          const greetUser = await this.app.api.client.kraken.users.getUser(msg.userInfo.userId);
          if (greetUser) {
            this.app.http.sendAlert('greet', {
              user: greetUser.displayName,
              image: greetUser.logoUrl
            });
          }

          if (this.triggers.shoutout) {
            this.app.commands.parseCommand(this.triggers.shoutout.command, [ null, user ], msg.userInfo);
          }
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
      this.processNlp(message.substring(message.indexOf(' ') + 1))
        .then((answer) => this.bot.say(channel, `${user}, ${answer}`));
    }

    if (message[0] !== '!' && !tobot) {
      return;
    }

    console.log(`${user}: ${message}`);

    if (message[0] !== '!') {
      return;
    }

    let trigger, alias = false;
    for (let i = 0; i < this.triggers._keys.length; i++) {
      const key = this.triggers._keys[i];
      if (key === message.substr(1, key.length + 1).trimRight().toLowerCase()) {
        trigger = this.triggers[key];
        alias = key;
        break
      }
    }

    if (!trigger) {
      return;
    }

    if (!msg.userInfo.isBroadcaster && Date.now() < Math.max(trigger.timeouts.global, trigger.timeouts.user[user] || 0)) {
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

    if (level < trigger.level) {
      return;
    }

    const params = message.trim().substring(alias.length + 2).split(/\s+/);
    params.unshift(trigger.trigger);
    this.app.commands.parseCommand(trigger.command, params, msg.userInfo)
      .then(() => {
        trigger.timeouts.global = Date.now() + trigger.global_timeout * 1000;
        trigger.timeouts.user[user] = Date.now() + trigger.user_timeout * 1000;
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
   * Send a whisper from the bot to a user.
   *
   * @param {string} user The target username
   * @param {string} message The message to send
   */
  whisper(user, message) {
    if (typeof user === 'string' && typeof message === 'string') {
      this.bot.whisper(user, message);
    }
  }

  /**
   * Process input text and generate a response.
   *
   * @param {string} text The input text
   */
  async processNlp(text) {
    const result = await this.nlp.process(text);
    let answer = result.score > 0.5 && result.answer ? result.answer : "Sorry, I don't understand";
    if (result.sentiment.score !== 0) {
      answer += result.sentiment.score > 0 ? ' :)' : ' :(';
    }

    return answer;
  }
}
