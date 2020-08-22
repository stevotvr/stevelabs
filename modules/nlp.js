/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import nlp from 'node-nlp';

/**
 * Handles natural language processing.
 */
export default class Nlp {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.manager = new nlp.NlpManager({ languages: ['en'] });
    this.manager.load('./data/model.nlp');
  }

  /**
   * Process input text and generate a response.
   *
   * @param {string} text The input text
   */
  process(text) {
    return new Promise(async resolve => {
      const result = await this.manager.process(text);
      let answer = result.score > 0.5 && result.answer ? result.answer : "Sorry, I don't understand";
      if (result.sentiment.score !== 0) {
        answer += result.sentiment.score > 0 ? ' :)' : ' :(';
      }

      resolve(answer);
    });
  }
}
