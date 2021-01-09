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
 * Provides the say command.
 */
export default class SayCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.say = this.say;
    commands.whisper = this.whisper;
  }

  async say(user, args = []) {
    this.app.chatbot.say(args.join(' '));
  }

  async whisper(user, args = []) {
    if (args.length < 2) {
      throw 'invalid arguments';
    }

    const targetUser = args.pop();
    this.app.chatbot.whisper(targetUser, args.join(' '));
  }
}
