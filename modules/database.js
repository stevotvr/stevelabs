/**
 * This file is part of StoveLabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

const sqlite3 = require('sqlite3');
const crypto = require('crypto');

/**
 * Handles database operations.
 */
class Database {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    // Create the database connection
    const db = new sqlite3.Database('./data/stovelabs.db', err => {
      if (err) {
        console.warn('database connection failed');
        console.log(err);

        return;
      }

      db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
          .all('SELECT key, value FROM settings', (err, rows) => {
            if (err) {
              console.warn('error loading settings from the database');
              console.log(err);

              return;
            }

            rows.forEach(row => {
              app.settings[row.key] = isNaN(row.value) ? row.value : +row.value;
            });

            if (!app.settings.secret) {
              app.settings.secret = crypto.randomBytes(64).toString('hex');
              app.saveSettings();
            }

            app.http.setupHttpRoutes();
            app.chatbot.setupTwitchClients();

            app.api.checkToken(app.settings.oauth_access_token, app.settings.oauth_refresh_token)
            .then(valid => {
              if (valid) {
                app.api.setWebhooks();
                app.api.checkStream();
              } else {
                console.log('invalid oauth2 tokens');
              }
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS alerts (key TEXT PRIMARY KEY, message TEXT, graphic TEXT, sound TEXT, duration INTEGER NOT NULL DEFAULT 5)')
                .prepare('INSERT OR IGNORE INTO alerts (key, message) VALUES (?, ?)')
                .run('cheer', '${user} cheered ${amount} bits!')
                .run('follower', '${user} is now following!')
                .run('subscription', '${user} has subscribed!')
                .run('resub', '${user} has resubscribed for ${months} months!')
                .run('subgift', '${user} gifted a subscription to ${recipient}!')
                .run('submysterygift', '${user} gifted subscriptions to ${subcount} lucky viewers!')
                .run('raid', '${user} raided the channel with ${viewers} viewers!')
                .run('host', '${user} hosted the channel with ${viewers} viewers!')
                .run('charitydonation', '${user} donated ${amount} to charity!')
                .run('rafflewinner', '${user} won the raffle!')
                .run('shoutout', 'Welcome, ${user}!')
                .finalize();
                this.loadAlerts();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, level INTEGER NOT NULL DEFAULT 0, user_timeout INTEGER NOT NULL DEFAULT 0, global_timeout INTEGER NOT NULL DEFAULT 0, aliases TEXT NOT NULL DEFAULT \'\', command TEXT NOT NULL)');
              this.loadCommands();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS timers (id INTEGER PRIMARY KEY AUTOINCREMENT, pos INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL)');
              this.loadTimers();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL DEFAULT 0, minute INTEGER NOT NULL DEFAULT 0, length INTEGER NOT NULL DEFAULT 0, game TEXT NOT NULL DEFAULT \'\')');
              this.loadSchedule();
            });

            db.serialize(() => {
              db.run('CREATE TABLE IF NOT EXISTS sfx (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, file TEXT NOT NULL)');
              this.loadSfx();
            });

            db.run('CREATE TABLE IF NOT EXISTS tips (id INTEGER PRIMARY KEY AUTOINCREMENT, date INTEGER NOT NULL, user TEXT NOT NULL DEFAULT \'\', message TEXT NOT NULL)');
            db.run('CREATE TABLE IF NOT EXISTS raffle (user TEXT PRIMARY KEY, tickets INTEGER NOT NULL DEFAULT 1)');
            db.run('CREATE TABLE IF NOT EXISTS autoshoutout (user TEXT PRIMARY KEY)');
          });
        });
      });

    this.db = db;
  }

  /**
   * Load the alerts from the database.
   */
  loadAlerts() {
    this.db.all('SELECT key, message, graphic, sound, duration FROM alerts', (err, rows) => {
      if (err) {
        console.warn('error loading alerts from the database');
        console.log(err);

        return;
      }

      this.app.alerts = {};
      rows.forEach(row => {
        this.app.alerts[row.key] = {
          message: row.message,
          graphic: row.graphic,
          sound: row.sound,
          duration: row.duration
        };
      });

      for (const key in this.app.alerts) {
        const alert = this.app.alerts[key];
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
    });
  }

  /**
   * Load the chat commands from the database.
   */
  loadCommands() {
    this.db.all('SELECT key, level, user_timeout, global_timeout, aliases, command FROM commands', (err, rows) => {
      if (err) {
        console.warn('error loading commands from the database');
        console.log(err);

        return;
      }

      this.app.commands = {};
      rows.forEach(row => {
        this.app.commands[row.key] = {
          level: row.level,
          user_timeout: row.user_timeout,
          global_timeout: row.global_timeout,
          aliases: row.aliases ? row.aliases.split(',') : [],
          command: row.command
        };
      });

      for (const k in this.app.commands) {
        for (const k2 in this.app.commands[k].aliases) {
          this.app.commands[this.app.commands[k].aliases[k2]] = this.app.commands[k];
        }

        this.app.commands[k].timeouts = {
          global: 0,
          user: {}
        };
      }
    });
  }

  /**
   * Load the timers from the database.
   */
  loadTimers() {
    this.db.all('SELECT message FROM timers ORDER BY pos', (err, rows) => {
      if (err) {
        console.warn('error loading timers from the database');
        console.log(err);

        return;
      }

      this.app.timers = [];
      rows.forEach(row => this.app.timers.push(row.message));
    });
  }

  /**
   * Load the schedule from the database.
   */
  loadSchedule() {
    this.db.all('SELECT day, hour, minute, length, game FROM schedule ORDER BY day, hour, minute, length', (err, rows) => {
      if (err) {
        console.warn('error loading schedule from the database');
        console.log(err);

        return;
      }

      this.app.schedule = [];
      rows.forEach(row => this.app.schedule.push(row));
    });
  }

  /**
   * Load the sound effects from the database.
   */
  loadSfx() {
    this.db.all('SELECT key, file FROM sfx', (err, rows) => {
      if (err) {
        console.warn('error loading sfx from the database');
        console.log(err);

        return;
      }

      this.app.sfx = {};
      rows.forEach(row => {
        this.app.sfx[row.key] = {
          file: row.file
        };
      });
    });
  }
}

module.exports.Database = Database;
