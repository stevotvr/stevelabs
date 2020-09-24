/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

/**
 * Provides the tip commands.
 */
export default class TipCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;
    this.db = commands.app.db.db;

    commands.tip = this.tip;
    commands.addtip = this.addtip;
    commands.edittip = this.edittip;
    commands.deletetip = this.deletetip;
  }

  async tip(user, args = []) {
    const cb = (err, row) => {
      if (err) {
        console.warn('error getting tip data');
        console.log(err);

        return;
      }

      if (row) {
        this.app.chatbot.say(`TIP #${row.id}: ${row.message}`);
      } else {
        this.app.chatbot.say(`Sorry, ${user}, we're all out of tips!`);
      }
    }

    if (args[0] && args[0].match(/\d+/)) {
      this.db.get('SELECT id, message FROM tips WHERE id = ?', args[0], cb);
    } else {
      this.db.get('SELECT id, message FROM tips ORDER BY RANDOM() LIMIT 1', cb);
    }
  }

  async addtip(user, args = []) {
    const message = args.join(' ');

    if (message.length < 2) {
      this.app.chatbot.say(`${user} Your tip message is too short (2 characters min, yours was ${message.length})`);
    } else if (message.length > 80) {
      this.app.chatbot.say(`${user} Your tip message is too long (80 characters max, yours was ${message.length})`);
    } else {
      const chatbot = this.app.chatbot;
      this.db.run('INSERT INTO tips (date, user, message) VALUES (?, ?, ?)', Date.now(), user, message, function (err) {
        if (err) {
          console.warn('error saving tip data');
          console.log(err);

          return;
        }

        chatbot.say(`Tip #${this.lastID} has been added to the list`);
      });
    }
  }

  async edittip(user, args = []) {
    if (args.length < 2 || !args[0].match(/\d+/)) {
      throw 'invalid arguments';
    }

    const message = args.slice(1).join(' ').trim();
    this.db.run('UPDATE tips SET message = ? WHERE id = ?', message, args[0], (err) => {
      if (err) {
        console.warn('error saving tip data');
        console.log(err);

        return;
      }

      this.app.chatbot.say(`Tip #${args[0]} has been edited!`);
    });
  }

  async deletetip(user, args = []) {
    if (args.length < 1 || !args[0].match(/\d+/)) {
      throw 'invalid arguments';
    }

    this.db.run('DELETE FROM tips WHERE id = ?', args[0], (err) => {
      if (err) {
        console.warn('error deleting tip data');
        console.log(err);

        return;
      }

      this.app.chatbot.say(`Tip #${args[0]} has been deleted!`);
    });
  }
}
