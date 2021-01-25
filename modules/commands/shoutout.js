/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2021, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

/**
 * Provides the shoutout command.
 */
export default class ShoutoutCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.shoutout = this.shoutout;
  }

  async shoutout(user, args = []) {
    if (args.length < 1) {
      return;
    }

    if (args.length > 1) {
      this.app.chatbot.say(args.slice(1).join(' '));
    }

    const soUser = await this.app.api.client.kraken.users.getUserByName(args[0]);
    if (soUser) {
      this.app.http.sendAlert('shoutout', {
        user: soUser.name,
        image: soUser.logoUrl
      });
    }
  }
}
