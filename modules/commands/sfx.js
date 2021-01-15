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
 * Provides the SFX command.
 */
export default class SfxCommand {

  /**
   * Constructor.
   *
   * @param {Commands} commands The main command module
   */
  constructor(commands) {
    this.app = commands.app;

    commands.sfx = this.sfx;
  }

  async sfx(user, args = []) {
    if(!args[0] || !this.app.http.sendSfx(args[0])) {
      throw 'sound not found';
    }
  }
}
