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

    const target = args.pop();
    const targetItem = args.join(' ');

    this.app.db.get('SELECT id, name, random FROM giveaway_groups WHERE name = ?', targetItem, (err, giveaway) => {
      if (err) {
        console.warn('error loading giveaways');
        console.log(err);

        return;
      }

      if (!giveaway) {
        this.app.chatbot.say(`@${user.displayName} There is no giveaway named ${targetItem}`);

        throw 'invalid giveaway';
      }

      const sql = `SELECT id, name, key FROM giveaway WHERE groupId = ? AND recipient IS NULL${giveaway.random ? ' ORDER BY RANDOM()' : ''} LIMIT 1`;
      this.app.db.get(sql, giveaway.id, async (err, row) => {
        if (err) {
          console.warn(`error loading item from giveaway #${giveaway.id}`);
          console.log(err);

          return;
        }

        if (!row) {
          console.log(`attempted to give item from empty giveaway ${giveaway.name} to ${target}`);
          this.app.chatbot.say(`@${user.displayName} oops, it looks like we are all out of items for ${giveaway.name}. :(`);

          throw 'empty giveaway';
        }

        const targetUser = await this.app.api.client.helix.users.getUserByName(target);
        if (!targetUser) {
          console.log(`attempted to give item from giveaway ${giveaway.name} to unknown user ${target}`);
          this.app.chatbot.say(`@${user.displayName} we could not find a user named ${target}.`);

          throw 'user not found';
        }

        this.app.chatbot.say(`@${targetUser.displayName} check your whispers for your key for ${row.name}!`);
        this.app.chatbot.whisper(targetUser.name, `Here is your key for ${row.name}: ${row.key}`);
        this.app.db.run('UPDATE giveaway SET recipient = (SELECT id FROM users WHERE userId = ?) WHERE id = ?', targetUser.id, row.id);

        console.log(`key ${row.key} for ${row.name} given to ${targetUser.displayName}`);
      });
    });
  }
}
