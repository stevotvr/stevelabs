/**
 * This file is part of Stevelabs.
 *
 * @copyright (c) 2020, Steve Guidetti, https://github.com/stevotvr
 * @license MIT
 *
 * For full license information, see the LICENSE.txt file included with the source.
 */

'use strict'

import fetch from 'node-fetch';

/**
 * Handles charity integrations.
 */
export default class Charity {

  /**
   * Constructor.
   *
   * @param {App} app The main application
   */
  constructor(app) {
    this.app = app;
  }

  /**
   * Initialize API query intervals.
   */
  init() {
    if (this.donordriveInterval) {
      clearInterval(this.donordriveInterval);
      this.donordriveInterval = 0;
    }

    if (this.app.settings.donordrive_instance && this.app.settings.donordrive_participant) {
      this.latestDonordriveDono = null;
      this.queryDonordrive();
      this.donordriveInterval = setInterval(() => this.queryDonordrive(), 15000);
    }

    if (this.tiltifyInterval) {
      clearInterval(this.tiltifyInterval);
      this.tiltifyInterval = 0;
    }

    if (this.app.settings.tiltify_access_token && this.app.settings.tiltify_campaign) {
      this.queryTiltify();
      this.latestTiltifyDono = null;
      this.tiltifyInterval = setInterval(() => this.queryTiltify(), 15000);
    }
  }

  /**
   * Query the DonorDrive API.
   */
  queryDonordrive() {
    fetch(`https://${this.app.settings.donordrive_instance}.donordrive.com/api/participants/${this.app.settings.donordrive_participant}/donations`)
    .then((res) => res.json())
    .then((json) => {
      if (json.length) {
        if (this.latestDonordriveDono !== null) {
          let i = 0;
          while (i < json.length && this.latestDonordriveDono !== json[i].donationID) {
            i++;
          }

          i--;

          for (; i >= 0; i--) {
            this.app.http.sendAlert('charitydonation', {
              user: json[i].displayName,
              amount: `\$${json[i].amount}`
            });
          }
        }

        this.latestDonordriveDono = json[0].donationID;
      } else {
        this.latestDonordriveDono = 0;
      }
    })
    .catch((err) => {
      console.warn('failed to query DonorDrive');
      console.log(err);
    });
  }

  /**
   * Query the Tiltify API.
   */
  queryTiltify() {
    fetch(`https://tiltify.com/api/v3/campaigns/${this.app.settings.tiltify_campaign}/donations`, {
      headers: {
        'Authorization': `Bearer ${this.app.settings.tiltify_access_token}`
      }
    })
    .then((res) => res.json())
    .then((json) => {
      if (json.data && json.data.length) {
        if (this.latestTiltifyDono !== null) {
          let i = 0;
          while (i < json.data.length && this.latestTiltifyDono !== json.data[i].id) {
            i++;
          }

          i--;

          for (; i >= 0; i--) {
            this.app.http.sendAlert('charitydonation', {
              user: json.data[i].name,
              amount: `\$${json.data[i].amount}`
            });
          }
        }

        this.latestTiltifyDono = json.data[0].id;
      } else {
        this.latestTiltifyDono = '';
      }
    })
    .catch((err) => {
      console.warn('failed to query Tiltify');
      console.log(err);
    });
  }
}
