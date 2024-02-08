import * as THREE from "https://cdn.skypack.dev/three@0.133.1/build/three.module";
import { OrbitControls } from "https://cdn.skypack.dev/three@0.133.1/examples/jsm/controls/OrbitControls";
const blob = document.getElementById("blob");

window.onpointermove = event => {
  const { clientX, clientY } = event;

  blob.animate({
    left: `${clientX}px`,
    top: `${clientY}px` },
  { duration: 5000, fill: "forwards" });
};
const containerEl = document.querySelector(".globe-wrapper");
const canvas3D = containerEl.querySelector("#globe-3d");
const canvas2D = containerEl.querySelector("#globe-2d-overlay");
const popupEl = containerEl.querySelector(".globe-popup");

let renderer, scene, camera, rayCaster, controls, group;
let overlayCtx = canvas2D.getContext("2d");
let coordinates2D = [0, 0];
let pointerPos;
let clock, mouse, pointer, globe, globeMesh;
let popupVisible = false;
let earthTexture, mapMaterial;
let popupOpenTl, popupCloseTl;

let dragged = false;

initScene();
window.addEventListener("resize", updateSize);


function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: canvas3D, alpha: true });
  renderer.setPixelRatio(2);

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1.1, 1.1, 1.1, -1.1, 0, 3);
  camera.position.z = 1.1;

  rayCaster = new THREE.Raycaster();
  rayCaster.far = 1.15;
  mouse = new THREE.Vector2(-1, -1);
  clock = new THREE.Clock();

  createOrbitControls();

  popupVisible = false;

  new THREE.TextureLoader().load(
  //"https://raw.githubusercontent.com/fruitbox12/workflowFunction/main/as.jpg",
  "https://ksenia-k.com/img/earth-map-colored.png",
  mapTex => {
    earthTexture = mapTex;
    earthTexture.repeat.set(1, 1);
    createGlobe();
    createPointer();
    createPopupTimelines();
    addCanvasEvents();
    updateSize();
    render();
  });
}


function createOrbitControls() {
  controls = new OrbitControls(camera, canvas3D);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.enableDamping = true;
  controls.minPolarAngle = .4 * Math.PI;
  controls.maxPolarAngle = .4 * Math.PI;
  controls.autoRotate = true;

  let timestamp;
  controls.addEventListener("start", () => {
    timestamp = Date.now();
  });
  controls.addEventListener("end", () => {
    dragged = Date.now() - timestamp > 600;
  });
}

function createGlobe() {
  const globeGeometry = new THREE.IcosahedronGeometry(1, 22);
  mapMaterial = new THREE.ShaderMaterial({
    vertexShader: document.getElementById("vertex-shader-map").textContent,
    fragmentShader: document.getElementById("fragment-shader-map").textContent,
    uniforms: {
      u_map_tex: { type: "t", value: earthTexture },
      u_dot_size: { type: "f", value: 0 },
      u_pointer: { type: "v3", value: new THREE.Vector3(.0, .0, 1.) },
      u_time_since_click: { value: 0 } },

    alphaTest: false,
    transparent: true });


  globe = new THREE.Points(globeGeometry, mapMaterial);
  scene.add(globe);

  globeMesh = new THREE.Mesh(globeGeometry, new THREE.MeshBasicMaterial({
    color: 0x00fff8,
    transparent: true,
    opacity: .04 }));

  scene.add(globeMesh);
}

function createPointer() {
  const geometry = new THREE.SphereGeometry(.04, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: 0x00ffaa,
    transparent: true,
    opacity: 0.5 });

  pointer = new THREE.Mesh(geometry, material);
  scene.add(pointer);
}


function updateOverlayGraphic() {
  let activePointPosition = pointer.position.clone();
  activePointPosition.applyMatrix4(globe.matrixWorld);
  const activePointPositionProjected = activePointPosition.clone();
  activePointPositionProjected.project(camera);
  coordinates2D[0] = (activePointPositionProjected.x + 1) * containerEl.offsetWidth * .5;
  coordinates2D[1] = (1 - activePointPositionProjected.y) * containerEl.offsetHeight * .5;

  const matrixWorldInverse = controls.object.matrixWorldInverse;
  activePointPosition.applyMatrix4(matrixWorldInverse);

  if (activePointPosition.z > -1) {
    if (popupVisible === false) {
      popupVisible = true;
      showPopupAnimation(false);
    }

    let popupX = coordinates2D[0];
    popupX -= activePointPositionProjected.x * containerEl.offsetWidth * .3;

    let popupY = coordinates2D[1];
    const upDown = activePointPositionProjected.y > .6;
    popupY += upDown ? 20 : -20;

    gsap.set(popupEl, {
      x: popupX,
      y: popupY,
      xPercent: -35,
      yPercent: upDown ? 0 : -100 });


    popupY += upDown ? -5 : 5;
    const curveMidX = popupX + activePointPositionProjected.x * 100;
    const curveMidY = popupY + (upDown ? -.5 : .1) * coordinates2D[1];

    drawPopupConnector(coordinates2D[0], coordinates2D[1], curveMidX, curveMidY, popupX, popupY);

  } else {
    if (popupVisible) {
      popupOpenTl.pause(0);
      popupCloseTl.play(0);
    }
    popupVisible = false;
  }
}

function addCanvasEvents() {
  containerEl.addEventListener("mousemove", e => {
    updateMousePosition(e.clientX, e.clientY);
  });

  containerEl.addEventListener("click", e => {
    if (!dragged) {
      updateMousePosition(
      e.targetTouches ? e.targetTouches[0].pageX : e.clientX,
      e.targetTouches ? e.targetTouches[0].pageY : e.clientY);


      const res = checkIntersects();
      if (res.length) {
        pointerPos = res[0].face.normal.clone();
        pointer.position.set(res[0].face.normal.x, res[0].face.normal.y, res[0].face.normal.z);
        mapMaterial.uniforms.u_pointer.value = res[0].face.normal;
        popupEl.innerHTML = cartesianToLatLong();
        showPopupAnimation(true);
        clock.start();
      }
    }
  });

  function updateMousePosition(eX, eY) {
    mouse.x = (eX - containerEl.offsetLeft) / containerEl.offsetWidth * 2 - 1;
    mouse.y = -((eY - containerEl.offsetTop) / containerEl.offsetHeight) * 2 + 1;
  }
}

function checkIntersects() {
  rayCaster.setFromCamera(mouse, camera);
  const intersects = rayCaster.intersectObject(globeMesh);
  if (intersects.length) {
    document.body.style.cursor = "pointer";
  } else {
    document.body.style.cursor = "auto";
  }
  return intersects;
}

function render() {
  mapMaterial.uniforms.u_time_since_click.value = clock.getElapsedTime();
  checkIntersects();
  if (pointer) {
    updateOverlayGraphic();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function updateSize() {
  const minSide = .65 * Math.min(window.innerWidth, window.innerHeight);
  containerEl.style.width = minSide + "px";
  containerEl.style.height = minSide + "px";
  renderer.setSize(minSide, minSide);
  canvas2D.width = canvas2D.height = minSide;
  mapMaterial.uniforms.u_dot_size.value = .04 * minSide;
}


//  ---------------------------------------
//  HELPERS

// popup content
function cartesianToLatLong() {
  const pos = pointer.position;
  const lat = 90 - Math.acos(pos.y) * 180 / Math.PI;
  const lng = (270 + Math.atan2(pos.x, pos.z) * 180 / Math.PI) % 360 - 180;
  return formatCoordinate(lat, 'N', 'S') + ",&nbsp;" + formatCoordinate(lng, 'E', 'W');
}

function formatCoordinate(coordinate, positiveDirection, negativeDirection) {
  const direction = coordinate >= 0 ? positiveDirection : negativeDirection;
  return `${Math.abs(coordinate).toFixed(4)}°&nbsp${direction}`;
}


// popup show / hide logic
function createPopupTimelines() {
  popupOpenTl = gsap.timeline({
    paused: true }).

  to(pointer.material, {
    duration: .2,
    opacity: 1 },
  0).
  fromTo(canvas2D, {
    opacity: 0 },
  {
    duration: .3,
    opacity: 1 },
  .15).
  fromTo(popupEl, {
    opacity: 0,
    scale: .9,
    transformOrigin: "center bottom" },
  {
    duration: .1,
    opacity: 1,
    scale: 1 },
  .15 + .1);

  popupCloseTl = gsap.timeline({
    paused: true }).

  to(pointer.material, {
    duration: .3,
    opacity: .2 },
  0).
  to(canvas2D, {
    duration: .3,
    opacity: 0 },
  0).
  to(popupEl, {
    duration: 0.3,
    opacity: 0,
    scale: 0.9,
    transformOrigin: "center bottom" },
  0);
}

function showPopupAnimation(lifted) {
  if (lifted) {
    let positionLifted = pointer.position.clone();
    positionLifted.multiplyScalar(1.3);
    gsap.from(pointer.position, {
      duration: .25,
      x: positionLifted.x,
      y: positionLifted.y,
      z: positionLifted.z,
      ease: "power3.out" });

  }
  popupCloseTl.pause(0);
  popupOpenTl.play(0);
}


// overlay (line between pointer and popup)
function drawPopupConnector(startX, startY, midX, midY, endX, endY) {
  overlayCtx.strokeStyle = "#ffb700";
  overlayCtx.lineWidth = 3;
  overlayCtx.lineCap = "round";
  overlayCtx.clearRect(0, 0, containerEl.offsetWidth, containerEl.offsetHeight);
  overlayCtx.beginPath();
  overlayCtx.moveTo(startX, startY);
  overlayCtx.quadraticCurveTo(midX, midY, endX, endY);
  overlayCtx.stroke();
}


// Placeholder for fetching Polkadot validator node data
async function fetchValidatorNodes() {
  // Implement fetching logic here
  // This should return an array of objects with latitude and longitude properties
  connectWebSocket();

  return [{ latitude: -34.603722, longitude: -58.381592 }]; // Example data
}
function latLongToVector3(latitude, longitude, radius = 1) {
  const phi = (90 - latitude) * (Math.PI / 180);
  const theta = (longitude + 180) * (Math.PI / 180);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

let websocket = null;
const telemetryURL = 'wss://feed.telemetry.polkadot.io/feed';

function connectWebSocket() {
  websocket = new WebSocket(telemetryURL);

  websocket.onopen = function () {
    console.log('WebSocket connected');
    // You can subscribe or send messages to the server if required by the protocol
  };

  websocket.onmessage = async event => {
    if (event.data instanceof Blob) {
      const text = await event.data.text();
      try {
        const data = JSON.parse(text);
        const messages = new Array(data.length / 2);

        for (let i = 0; i < messages.length; i++) {
          const item = messages[i];
          // Check if the item is an array with the expected structure
          if (Array.isArray(item) && item.length === 8 && item[6] && item[6].length === 3) {
            const [latitude, longitude, locationName] = item[6];

            // Found the Helsinki coordinates, now update the globe popup
            updateGlobePopup(latitude, longitude, locationName);
            break; // Stop searching after finding Helsinki

          }
        }
        if (data.type === 'validatorNodes') {
          console.log("Validator Nodes:", data.nodes);

          // If you need to process the list of validator nodes further, do it here
          data.nodes.forEach(node => {
            console.log(`Validator Node: ${node.id}, Status: ${node.status}`);
          });
        }
        websocket.send(`subscribe:0x05d5279c52c484cc80396535a316add7d47b1c5b9e0398dd1f584149341460c5`);
        websocket.send(`send-finality:0x05d5279c52c484cc80396535a316add7d47b1c5b9e0398dd1f584149341460c5`);
        console.log(data);
        const { latitude, longitude } = parseWebSocketData(data);
        if (latitude && longitude) {
          updateGlobePopup(latitude, longitude);
        }
        for (const index of messages.keys()) {
          const [action, payload] = data.slice(index * 2);

          messages[index] = { action, payload };
        }
        // Handle your JSON data here
      } catch (error) {
        console.error("Error parsing JSON from Blob:", error);
      }
    } else {
      try {
        const data = JSON.parse(event.data);
        // Handle your JSON data here
      } catch (error) {
        console.error("Error parsing JSON:", error);
      }
    }
  };

  websocket.onclose = function () {
    console.log('WebSocket disconnected. Reconnecting...');
    setTimeout(connectWebSocket, 1000); // Reconnect
  };

  websocket.onerror = function (error) {
    console.error('WebSocket Error: ', error);
  };
}

fetchValidatorNodes(); // Fetch and display Polkadot validator nodes
const parse = val => {
  try {
    console.log(JSON.parse(val.data));
    const messages = new Array(data.length / 2);
    let locationData = null; // To store longitude and latitude if present

    for (const index of messages.keys()) {
      const [action, payload] = data.slice(index * 2);
      // Check if payload contains longitude and latitude
      if (payload && payload.longitude && payload.latitude) {
        locationData = { longitude: payload.longitude, latitude: payload.latitude };
      }
      messages[index] = { action, payload };
    }return locationData || messages;


  } catch (error) {
    console.error("Error parsing JSON:", error);
    return null; // or undefined, or however you want to handle parse errors
  }
};
function deserialize(data) {
  const json = parse(data);

  if (!Array.isArray(json) || json.length === 0 || json.length % 2 !== 0) {
    throw new Error('Invalid FeedMessage.Data');
  }

  const messages = new Array() < Message > json.length / 2;

  for (const index of messages.keys()) {
    const [action, payload] = json.slice(index * 2);

    messages[index] = { action, payload };
  }

  return messages;
}
function updateGlobePopup(latitude, longitude) {
  // Convert latitude and longitude to spherical coordinates
  const radius = 2; // Assuming your globe's radius is 2
  const phi = (90 - latitude) * Math.PI / 180;
  const theta = (longitude + 180) * Math.PI / 180;

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  // Check if the pointer (marker) already exists, if not, create it
  if (!pointer) {
    const geometry = new THREE.SphereGeometry(0.05, 32, 32); // Small sphere geometry for the marker
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red color marker
    pointer = new THREE.Mesh(geometry, material);
    scene.add(pointer);
  }

  // Update pointer position
  pointer.position.set(x, y, z);

  // Update popup content and position
  const popupContent = `Latitude: ${latitude.toFixed(2)}, Longitude: ${longitude.toFixed(2)}`;
  popupEl.innerHTML = popupContent;

  // Convert 3D position to 2D screen position
  const vector = new THREE.Vector3(x, y, z);
  vector.project(camera);

  const x2D = (vector.x * .5 + .5) * containerEl.clientWidth;
  const y2D = (-(vector.y * .5) + .5) * containerEl.clientHeight;

  // Update popup element position
  popupEl.style.transform = `translate(-50%, -100%) translate(${x2D}px, ${y2D}px)`;
  popupEl.style.display = 'block';

  // Ensure the popup is visible and adjust its positioning as necessary
  if (!popupVisible) {
    popupEl.style.opacity = 1;
    popupVisible = true;
  }
}
function parseWebSocketData(data) {
  // Initialize an empty array to hold the extracted location data
  let locations = [];

  // Iterate through the main array
  for (let i = 0; i < data.length; i++) {
    // Check for the structure that contains the location information
    // Assuming this structure is an array with 3 elements: [latitude, longitude, "Location Name"]
    if (Array.isArray(data[i]) && data[i].length === 3 && typeof data[i][0] === "number" && typeof data[i][1] === "number" && typeof data[i][2] === "string") {
      // Extract the latitude, longitude, and location name
      const [latitude, longitude, locationName] = data[i];

      // Add the extracted information to the locations array
      locations.push({ latitude, longitude, locationName });
    }
  }

  // Return the array of locations
  return locations;
}

const MIN = document.querySelector('#min');
const MAX = document.querySelector('#max');
const MAX_LABEL = document.querySelector('[for=max]');
const MIN_LABEL = document.querySelector('[for=min]');

const HORIZONTAL = document.querySelector('#horizontal');

const CONSTRAIN = () => {
  document.documentElement.style.setProperty('--min', MIN.value);
  document.documentElement.style.setProperty('--max', MAX.value);
};

MIN.addEventListener('input', CONSTRAIN);
MAX.addEventListener('input', CONSTRAIN);
CONSTRAIN();

const sharedProps = {
  spellcheck: false,
  name: 'textarea',
  id: 'textarea',
  placeholder: 'Type your message...' };

const SWITCH_MODE = () => {
  console.info('coll');
  const INPUT = document.querySelector('#textarea');
  if (INPUT.tagName === 'TEXTAREA') {
    // Update the labels at this point too
    MIN_LABEL.innerText = 'min-width (ch)';
    MAX_LABEL.innerText = 'max-width (ch)';
    MIN.setAttribute('min', 40);
    MIN.setAttribute('max', 100);
    MAX.setAttribute('min', 100);
    MAX.setAttribute('max', 200);
    INPUT.replaceWith(Object.assign(document.createElement('input'), sharedProps));
  } else {
    // Update the labels at this point too
    MIN_LABEL.innerText = 'min-height (lh)';
    MAX_LABEL.innerText = 'max-height (lh)';
    MIN.setAttribute('min', 1);
    MIN.setAttribute('max', 10);
    MAX.setAttribute('min', 5);
    MAX.setAttribute('max', 20);
    INPUT.replaceWith(Object.assign(document.createElement('textarea'), sharedProps));
  }
};

HORIZONTAL.addEventListener('change', SWITCH_MODE);


const POINTER_SYNC = ({ x, y }) => {
  document.documentElement.style.setProperty('--x', x);
  document.documentElement.style.setProperty('--y', y);
};
document.body.addEventListener('pointermove', POINTER_SYNC);