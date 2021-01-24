/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

/**
 * Provides the giveaway commands.
 */
export default class GiveawayCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.giveaway = this.giveaway;
  }

  async giveaway(user, args = []) {
    if (args.length < 2) {
      throw 'invalid arguments';
    }

    const targetUser = args.pop();
    const targetItem = args.join(' ');

    this.app.db.get('SELECT id, name, random FROM giveaway_groups WHERE name = ?', targetItem, (err, giveaway) => {
      if (err) {
        console.warn('error loading giveaways');
        console.log(err);

        return;
      }

      if (!giveaway) {
        this.app.chatbot.say(`@${user} There is no giveaway named ${targetItem}`);

        throw 'invalid giveaway';
      }

      const sql = `SELECT id, name, key FROM giveaway WHERE groupId = ? AND recipient IS NULL${giveaway.random ? ' ORDER BY RANDOM()' : ''} LIMIT 1`;
      this.app.db.get(sql, giveaway.id, (err, row) => {
        if (err) {
          console.warn(`error loading item from giveaway #${giveaway.id}`);
          console.log(err);

          return;
        }

        if (!row) {
          console.log(`attempted to give item from empty giveaway ${giveaway.name} to ${targetUser}`);
          this.app.chatbot.say(`@${user} oops, it looks like we are all out of items for ${giveaway.name}. :(`);

          throw 'empty giveaway';
        }

        this.app.chatbot.say(`@${targetUser} check your whispers for your key for ${row.name}!`);
        this.app.chatbot.whisper(targetUser, `Here is your key for ${row.name}: ${row.key}`);
        this.app.db.run('UPDATE giveaway SET recipient = ? WHERE id = ?', targetUser, row.id);

        console.log(`key ${row.key} for ${row.name} given to ${targetUser}`);
      });
    });
  }
}
