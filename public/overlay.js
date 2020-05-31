'use strict'

const alertQueue = [];

const socket = io('//' + window.location.host);

socket.on('connect', () => {
  console.log('connected to socket');
});

socket.on('disconnect', () => {
  console.log('socket connection lost');
});

socket.on('alert', (type, params, duration) => {
  addAlert(type, params, duration);
});

let latestDonation = null;

if (config.donordrive.instance && config.donordrive.participant) {
  queryDonorDrive();
  setInterval(queryDonorDrive, 15000);
}

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
