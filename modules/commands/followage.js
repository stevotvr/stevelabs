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
 * Provides the followage command.
 */
export default class FollowageCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.followage = this.followage;
  }

  async followage(user, args = []) {
    const target = args[0] ? args[0] : user;
    const targetUser = await this.app.api.client.kraken.users.getUserByName(target);
    if (targetUser) {
      const follow = await targetUser.getFollowTo(this.app.api.userId);
      if (follow) {
        this.app.chatbot.say(`${target} has been following since ${follow.followDate}`);
        return;
      }
    }

    this.app.chatbot.say(`${target} is not following`);
  }
}
