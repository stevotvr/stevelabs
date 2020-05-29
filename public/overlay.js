var socket = io('//' + window.location.host);

socket.on('connect', () => {
  console.log('connected to socket');
});

socket.on('disconnect', () => {
  console.log('socket connection lost');
});

socket.on('alert', (type, params, duration) => {
  var alertElem = document.getElementById(type);
  if (!alertElem) {
    return;
  }

  var messageElems = alertElem.getElementsByTagName('p');
  if (messageElems && messageElems.length) {
    for (var key in params) {
      var elems = messageElems[0].getElementsByClassName(key);
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
  }, duration);

  var videoElems = alertElem.getElementsByTagName('video');
  if (videoElems && videoElems.length) {
    videoElems[0].play();
  }

  var audioElems = alertElem.getElementsByTagName('audio');
  if (audioElems && audioElems.length) {
    audioElems[0].play();
  }

  console.log(type, params, duration);
});
