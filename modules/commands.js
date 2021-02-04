/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict';

import FollowageCommand from './commands/followage.js';
import GiveawayCommand from './commands/giveaway.js';
import LeaderboardCommand from './commands/leaderboard.js'
import QuoteCommand from './commands/quote.js';
import RaffleCommand from './commands/raffle.js';
import SayCommand from './commands/say.js';
import SfxCommand from './commands/sfx.js';
import ShoutoutCommand from './commands/shoutout.js';
import TipCommand from './commands/tip.js';
import TriviaCommand from './commands/trivia.js';
import TtsCommand from './commands/tts.js';

/**
 * Handles common functions via commands.
 */
export default class Commands {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;

    new FollowageCommand(this);
    new GiveawayCommand(this);
    new LeaderboardCommand(this);
    new QuoteCommand(this);
    new RaffleCommand(this);
    new SayCommand(this);
    new SfxCommand(this);
    new ShoutoutCommand(this);
    new TipCommand(this);
    new TriviaCommand(this);
    new TtsCommand(this);
  }

  /**
   * Parse a command string.
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

    let user;
    if (parsed.includes('${game ')) {
      user = await this.app.api.client.kraken.users.getUserByName(userInfo.userName);
    }

    parsed = parsed.replace(/\$\{user\}/gi, userInfo ? userInfo.displayName : 'user');

    const promises = [];
    parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, (match, fn, p) => {
      promises.push(new Promise(async (resolve) => {
        switch (fn) {
          case 'channel':
            resolve(p.toLowerCase());
            break;
          case 'game':
            if (!p) {
              resolve(this.app.api.game);
              break;
            }

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
    parsed = parsed.replace(/\$\{([a-z][0-9a-z]*)(?: (.+?))?\}/gi, () => values.shift()).split(/\s+/);
    if (!parsed.length || this[parsed[0]] === undefined) {
      throw 'command not found';
    }

    return await this[parsed[0]](userInfo, parsed.slice(1));
  }
}
