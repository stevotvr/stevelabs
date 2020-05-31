'use strict'

/**
 * Setup
 */

// Queue of events ready to be displayed
const alertQueue = [];

// Create the socket connection
const socket = io('//' + window.location.host);

/**
 * Hook socket events
 */

// Socket connected event
socket.on('connect', () => {
  console.log('connected to socket');
});

// Socket disconnected event
socket.on('disconnect', () => {
  console.log('socket connection lost');
});

// New alert event
socket.on('alert', (type, params, duration) => {
  addAlert(type, params, duration);
});

/**
 * Functions
 */

/**
 * Add a new alert to the queue.
 *
 * @param {string} type The type of event
 * @param {object} params The event parameters
 * @param {int} duration The event duration in milliseconds
 */
function addAlert(type, params, duration) {
  alertQueue.push({
    type: type,
    params: params,
    duration: duration
  });

  if (alertQueue.length === 1) {
    showNextAlert();
  }

  console.log(type, params, duration);
}

/**
 * Show the next alert in the queue.
 */
function showNextAlert() {
  if (!alertQueue.length) {
    return;
  }

  const { type, params, duration } = alertQueue[0];

  const alertElem = document.getElementById(type);
  if (!alertElem) {
    return;
  }

  const messageElems = alertElem.getElementsByTagName('p');
  if (messageElems && messageElems.length) {
    for (const key in params) {
      const elems = messageElems[0].getElementsByClassName(key);
      if (elems) {
        for (let i = 0; i < elems.length; i++) {
          elems[i].innerText = params[key];
        }
      }
    }
  }

  alertElem.style.opacity = 1;
  setTimeout(() => {
    alertElem.style.opacity = 0;
    setTimeout(() => {
      alertQueue.shift();
      showNextAlert();
    }, 1000);
  }, duration);

  const videoElems = alertElem.getElementsByTagName('video');
  if (videoElems && videoElems.length) {
    videoElems[0].currentTime = 0;
    videoElems[0].play();
  }

  const audioElems = alertElem.getElementsByTagName('audio');
  if (audioElems && audioElems.length) {
    audioElems[0].currentTime = 0;
    audioElems[0].play();
  }
}

/**
 * DonorDrive
 */

// The ID of the latest donation
let latestDonation = null;

// Start querying the DonorDrive API
if (config.donordrive.instance && config.donordrive.participant) {
  queryDonorDrive();
  setInterval(queryDonorDrive, 15000);
}

/**
 * Query the DonorDrive API
 */
function queryDonorDrive() {
  fetch(`https://${config.donordrive.instance}.donordrive.com/api/participants/${config.donordrive.participant}/donations`)
  .then(res => res.json())
  .then(json => {
    console.log(latestDonation);
    if (json.length) {
      if (latestDonation !== null) {
        let i = 0;
        while (latestDonation !== json[i].donationID) {
          i++;
        }

        i--;

        for (; i >= 0; i--) {
          addAlert('charitydonation', {
            user: json[i].displayName,
            amount: `\$${json[i].amount}`
          }, config.donordrive.alertduration);
        }
      }

      latestDonation = json[0].donationID;
    } else {
      latestDonation = '';
    }
  })
  .catch(err => {
    console.warn('failed to query DonorDrive');
    console.log(err);
  });
}
