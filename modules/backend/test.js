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
 * Handler for the test backend.
 */
export default class TestBackend {
  get(resolve) {
    resolve();
  }

  post(resolve, req) {
    if (req.body.alert) {
      const params = {
        amount: Math.round(Math.random() * 10),
        image: '/testuser.jpg',
        months: Math.round(Math.random() * 36),
        recipient: `user${Math.round(Math.random() * 100)}`,
        subcount: Math.round(Math.random() * 15),
        user: `user${Math.round(Math.random() * 100)}`,
        viewers: Math.round(Math.random() * 10)
      };

      if (req.body.alert === 'charitydonation') {
        params.amount = `\$${params.amount}.00`;
      }

      this.app.http.sendAlert(req.body.alert, params);
    } else if (req.body.sfx) {
      this.app.http.sendSfx(req.body.sfx);
    }

    resolve(false);
  }
}
