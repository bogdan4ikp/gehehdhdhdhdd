/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, DRACOLoader } from 'three-stdlib';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LoadingScreen } from './components/LoadingScreen';
import { CityGenerator } from './CityGenerator';

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [uiText, setUiText] = useState('');
  const [speed, setSpeed] = useState(0);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    // --- SCENE SETUP ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // Minimap Camera
    const minimapCamera = new THREE.OrthographicCamera(-50, 50, 50, -50, 1, 1000);
    minimapCamera.position.set(0, 100, 0);
    minimapCamera.lookAt(0, 0, 0);

    // --- HUD SCENE FOR MINIMAP ---
    const minimapRenderTarget = new THREE.WebGLRenderTarget(200, 200);
    const hudScene = new THREE.Scene();
    const hudCamera = new THREE.OrthographicCamera(-window.innerWidth/2, window.innerWidth/2, window.innerHeight/2, -window.innerHeight/2, 0.1, 10);
    hudCamera.position.z = 1;

    const minimapGeo = new THREE.CircleGeometry(100, 64);
    const minimapMat = new THREE.MeshBasicMaterial({
      map: minimapRenderTarget.texture,
      depthTest: false,
      transparent: true
    });
    const minimapMesh = new THREE.Mesh(minimapGeo, minimapMat);
    minimapMesh.position.set(window.innerWidth/2 - 120, -window.innerHeight/2 + 120, 0);
    hudScene.add(minimapMesh);

    const borderGeo = new THREE.RingGeometry(100, 104, 64);
    const borderMat = new THREE.MeshBasicMaterial({ color: 0x222222, depthTest: false });
    const borderMesh = new THREE.Mesh(borderGeo, borderMat);
    borderMesh.position.copy(minimapMesh.position);
    hudScene.add(borderMesh);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for 120fps
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false; // For minimap rendering
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    // --- ENVIRONMENT & POST-PROCESSING ---
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // Lower resolution bloom for mobile performance
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 1.2, 0.4, 0.85);
    bloomPass.threshold = 0.8;
    bloomPass.strength = 0.4;
    bloomPass.radius = 0.5;
    composer.addPass(bloomPass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.mapSize.width = 1024; // Optimized from 2048
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);
    
    // Day/Night cycle variables
    let timeOfDay = 8; // Start at 8 AM
    const timeScale = 0.015; // Game hours per real second (24 hours = ~1666 seconds = ~27 minutes). Ночь длится > 10 минут.

    // --- PHYSICS WORLD ---
    const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = 0.5;

    // --- CITY BLOCKS (ENVIRONMENT) ---
    const cityGen = new CityGenerator(scene, world);
    cityGen.generate();

    // --- STATE ---
    let gameState = 'on_foot'; // 'on_foot' | 'driving'
    let currentVehicle: any = null;

    // --- PLAYER ---
    const playerBody = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Sphere(0.5),
      fixedRotation: true,
      linearDamping: 0.9,
    });
    playerBody.position.set(0, 5, 0);
    world.addBody(playerBody);

    let playerMesh: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let actions: Record<string, THREE.AnimationAction> = {};
    let currentAction = 'Idle';

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);

    loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/Soldier.glb', (gltf) => {
      playerMesh = gltf.scene;
      playerMesh.scale.set(1, 1, 1);
      playerMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(playerMesh);

      mixer = new THREE.AnimationMixer(playerMesh);
      gltf.animations.forEach((clip) => {
        actions[clip.name] = mixer!.clipAction(clip);
      });
      
      if (actions['Idle']) actions['Idle'].play();
      
      setProgress(100);
      setTimeout(() => setLoading(false), 500);
    }, (xhr) => {
      setProgress(Math.round((xhr.loaded / xhr.total) * 100));
    });

    // --- VEHICLES ---
    const vehicles: any[] = [];
    let carModelTemplate: THREE.Group | null = null;

    const spawnCar = (position: THREE.Vector3) => {
      if (!carModelTemplate) return;

      const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.5, 2));
      const chassisBody = new CANNON.Body({ mass: 800 });
      chassisBody.addShape(chassisShape);
      chassisBody.position.copy(position as any);
      world.addBody(chassisBody);
      
      const vehicle = new CANNON.RaycastVehicle({
        chassisBody: chassisBody,
        indexRightAxis: 0,
        indexUpAxis: 1,
        indexForwardAxis: 2,
      });

      const wheelOptions = {
        radius: 0.5,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 40,
        suspensionRestLength: 0.4,
        frictionSlip: 3,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.1,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 1, 0),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      };

      wheelOptions.chassisConnectionPointLocal.set(1, 0, -1.2);
      vehicle.addWheel(wheelOptions);
      wheelOptions.chassisConnectionPointLocal.set(-1, 0, -1.2);
      vehicle.addWheel(wheelOptions);
      wheelOptions.chassisConnectionPointLocal.set(1, 0, 1.2);
      vehicle.addWheel(wheelOptions);
      wheelOptions.chassisConnectionPointLocal.set(-1, 0, 1.2);
      vehicle.addWheel(wheelOptions);

      vehicle.addToWorld(world);

      const wheelBodies: CANNON.Body[] = [];
      const wheelMeshes: THREE.Mesh[] = [];
      const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 20);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

      vehicle.wheelInfos.forEach((wheel) => {
        const cylinderShape = new CANNON.Cylinder(wheel.radius, wheel.radius, wheel.radius / 2, 20);
        const wheelBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
        const q = new CANNON.Quaternion();
        q.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
        wheelBody.addShape(cylinderShape, new CANNON.Vec3(), q);
        wheelBodies.push(wheelBody);
        world.addBody(wheelBody);
        
        const mesh = new THREE.Mesh(wheelGeo, wheelMat);
        mesh.castShadow = true;
        scene.add(mesh);
        wheelMeshes.push(mesh);
      });

      const carContainer = new THREE.Group();
      const clonedModel = carModelTemplate.clone();
      
      // Randomize color for new cars
      clonedModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.name.includes('body')) {
          const mat = ((child as THREE.Mesh).material as THREE.MeshPhysicalMaterial).clone();
          mat.color.setHSL(Math.random(), 1, 0.5);
          (child as THREE.Mesh).material = mat;
        }
      });
      
      carContainer.add(clonedModel);
      scene.add(carContainer);

      vehicles.push({
        vehicle,
        chassisBody,
        wheelBodies,
        wheelMeshes,
        carContainer
      });
    };

    loader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/ferrari.glb', (gltf) => {
      carModelTemplate = gltf.scene;
      carModelTemplate.scale.set(1, 1, 1);
      carModelTemplate.position.set(0, -0.5, 0); // Adjust based on chassis
      carModelTemplate.rotation.y = Math.PI; // Face forward
      
      const bodyMat = new THREE.MeshPhysicalMaterial({
        color: 0xff0000, metalness: 0.9, roughness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.01
      });
      
      carModelTemplate.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.name.includes('body')) {
            (child as THREE.Mesh).material = bodyMat;
          }
        }
      });
      
      // Spawn initial car
      spawnCar(new THREE.Vector3(10, 2, 0));
    });

    // --- CONTROLS ---
    const keys: Record<string, boolean> = {};
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      
      // Interaction
      if (e.code === 'KeyE' && gameState === 'on_foot') {
        let closestDist = 4;
        let closestVehicle = null;
        
        for (const v of vehicles) {
          const dist = playerBody.position.distanceTo(v.chassisBody.position);
          if (dist < closestDist) {
            closestDist = dist;
            closestVehicle = v;
          }
        }

        if (closestVehicle) {
          gameState = 'driving';
          currentVehicle = closestVehicle;
          if (playerMesh) playerMesh.visible = false;
          playerBody.position.set(0, -100, 0); // Hide player physics
          setUiText('');
        }
      } else if (e.code === 'KeyF' && gameState === 'driving') {
        gameState = 'on_foot';
        if (playerMesh) playerMesh.visible = true;
        
        // Place player next to car
        const offset = new CANNON.Vec3(3, 1, 0);
        currentVehicle.chassisBody.quaternion.vmult(offset, offset);
        playerBody.position.copy(currentVehicle.chassisBody.position.vadd(offset));
        playerBody.velocity.set(0,0,0);
        currentVehicle = null;
      } else if (e.code === 'KeyV' && gameState === 'on_foot') {
        // Spawn car near player
        const spawnPos = new THREE.Vector3(playerBody.position.x + 5, playerBody.position.y + 2, playerBody.position.z);
        spawnCar(spawnPos);
      }
      
      // Jump
      if (e.code === 'Space' && gameState === 'on_foot') {
        // Simple grounded check
        if (Math.abs(playerBody.velocity.y) < 0.1) {
          playerBody.wakeUp();
          playerBody.velocity.y = 5;
        }
      }
    });
    window.addEventListener('keyup', (e) => keys[e.code] = false);

    // Mouse Look
    let yaw = 0;
    let pitch = 0;
    renderer.domElement.addEventListener('click', () => {
      renderer.domElement.requestPointerLock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === renderer.domElement) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
      }
    });

    // Touch Look & Joystick
    let lastTouchX = 0;
    let lastTouchY = 0;
    let lookTouchId: number | null = null;
    let joystickActive = false;
    let joystickVector = new THREE.Vector2(0, 0);

    const joystickZone = document.createElement('div');
    joystickZone.style.position = 'absolute';
    joystickZone.style.bottom = '40px';
    joystickZone.style.left = '40px';
    joystickZone.style.width = '120px';
    joystickZone.style.height = '120px';
    joystickZone.style.borderRadius = '50%';
    joystickZone.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    joystickZone.style.border = '2px solid rgba(255, 255, 255, 0.2)';
    joystickZone.style.touchAction = 'none';
    joystickZone.style.display = 'none'; // Show on touch
    
    const joystickKnob = document.createElement('div');
    joystickKnob.style.position = 'absolute';
    joystickKnob.style.top = '35px';
    joystickKnob.style.left = '35px';
    joystickKnob.style.width = '50px';
    joystickKnob.style.height = '50px';
    joystickKnob.style.borderRadius = '50%';
    joystickKnob.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
    joystickZone.appendChild(joystickKnob);
    mount.appendChild(joystickZone);

    const updateJoystick = (touch: Touch) => {
      const rect = joystickZone.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let dx = touch.clientX - centerX;
      let dy = touch.clientY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 35;
      if (distance > maxDist) {
        dx = (dx / distance) * maxDist;
        dy = (dy / distance) * maxDist;
      }
      joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      joystickVector.set(dx / maxDist, dy / maxDist);
    };

    // Mobile Action Buttons
    const actionBtn = document.createElement('button');
    actionBtn.innerText = '🚗';
    actionBtn.style.position = 'absolute';
    actionBtn.style.bottom = '40px';
    actionBtn.style.right = '40px';
    actionBtn.style.width = '60px';
    actionBtn.style.height = '60px';
    actionBtn.style.borderRadius = '50%';
    actionBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    actionBtn.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    actionBtn.style.fontSize = '24px';
    actionBtn.style.touchAction = 'none';
    actionBtn.style.display = 'none';
    actionBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: gameState === 'on_foot' ? 'KeyE' : 'KeyF' }));
    });
    mount.appendChild(actionBtn);

    const jumpBtn = document.createElement('button');
    jumpBtn.innerText = '⬆️';
    jumpBtn.style.position = 'absolute';
    jumpBtn.style.bottom = '120px';
    jumpBtn.style.right = '40px';
    jumpBtn.style.width = '60px';
    jumpBtn.style.height = '60px';
    jumpBtn.style.borderRadius = '50%';
    jumpBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    jumpBtn.style.border = '2px solid rgba(255, 255, 255, 0.3)';
    jumpBtn.style.fontSize = '24px';
    jumpBtn.style.touchAction = 'none';
    jumpBtn.style.display = 'none';
    jumpBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    });
    mount.appendChild(jumpBtn);

    joystickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      joystickActive = true;
      updateJoystick(e.touches[0]);
    }, { passive: false });
    joystickZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (joystickActive) updateJoystick(e.touches[0]);
    }, { passive: false });
    joystickZone.addEventListener('touchend', () => {
      joystickActive = false;
      joystickVector.set(0, 0);
      joystickKnob.style.transform = `translate(0px, 0px)`;
    });

    renderer.domElement.addEventListener('touchstart', (e) => {
      joystickZone.style.display = 'block'; // Enable mobile UI on first touch
      actionBtn.style.display = 'block';
      jumpBtn.style.display = 'block';
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.clientX > window.innerWidth / 2 && lookTouchId === null) {
          lookTouchId = touch.identifier;
          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
        }
      }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', (e) => {
      e.preventDefault(); // Prevent scrolling
      if (lookTouchId !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === lookTouchId) {
            const movementX = touch.clientX - lastTouchX;
            const movementY = touch.clientY - lastTouchY;
            
            yaw -= movementX * 0.005;
            pitch -= movementY * 0.005;
            pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
            
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
          }
        }
      }
    }, { passive: false });

    renderer.domElement.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId) {
          lookTouchId = null;
        }
      }
    });

    // --- ANIMATION LOOP ---
    const clock = new THREE.Clock();
    
    // Smooth camera target
    const cameraTarget = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    
    const animate = () => {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      
      world.step(1 / 60, dt, 3);
      
      // Day/Night Cycle
      timeOfDay += dt * timeScale;
      if (timeOfDay >= 24) timeOfDay -= 24;
      
      const sunAngle = ((timeOfDay - 6) / 24) * Math.PI * 2;
      dirLight.position.x = Math.cos(sunAngle) * 200;
      dirLight.position.y = Math.sin(sunAngle) * 200;
      
      if (dirLight.position.y < 0) {
        dirLight.intensity = 0;
        ambientLight.intensity = 0.1;
        scene.background = new THREE.Color(0x050510);
        scene.fog = new THREE.FogExp2(0x050510, 0.005);
      } else {
        dirLight.intensity = Math.min(1.5, dirLight.position.y / 50);
        ambientLight.intensity = 0.4;
        
        // Sunset/Sunrise colors
        if (dirLight.position.y < 50) {
          const t = dirLight.position.y / 50;
          const color = new THREE.Color().lerpColors(new THREE.Color(0xffaa55), new THREE.Color(0x87ceeb), t);
          scene.background = color;
          scene.fog = new THREE.FogExp2(color, 0.005);
        } else {
          scene.background = new THREE.Color(0x87ceeb);
          scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);
        }
      }

      // --- ON FOOT LOGIC ---
      if (gameState === 'on_foot') {
        const speed = keys['ShiftLeft'] ? 8 : 4;
        const moveDir = new THREE.Vector3();
        
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

        const inputY = (keys['KeyW'] ? -1 : 0) + (keys['KeyS'] ? 1 : 0) + (joystickActive ? joystickVector.y : 0);
        const inputX = (keys['KeyA'] ? -1 : 0) + (keys['KeyD'] ? 1 : 0) + (joystickActive ? joystickVector.x : 0);
        
        moveDir.addScaledVector(forward, -inputY);
        moveDir.addScaledVector(right, inputX);

        if (moveDir.lengthSq() > 0) {
          playerBody.wakeUp(); // Fix character not moving!
          moveDir.normalize().multiplyScalar(speed);
        }
        
        playerBody.velocity.x = moveDir.x;
        playerBody.velocity.z = moveDir.z;

        if (playerMesh) {
          playerMesh.position.copy(playerBody.interpolatedPosition as any);
          playerMesh.position.y -= 0.5; // Offset for sphere center
          
          if (moveDir.lengthSq() > 0.1) {
            const targetRotation = Math.atan2(moveDir.x, moveDir.z);
            playerMesh.rotation.y = targetRotation;
            
            const nextAction = keys['ShiftLeft'] ? 'Run' : 'Walk';
            if (currentAction !== nextAction && actions[nextAction]) {
              actions[currentAction]?.fadeOut(0.2);
              actions[nextAction].reset().fadeIn(0.2).play();
              currentAction = nextAction;
            }
          } else {
            if (currentAction !== 'Idle' && actions['Idle']) {
              actions[currentAction]?.fadeOut(0.2);
              actions['Idle'].reset().fadeIn(0.2).play();
              currentAction = 'Idle';
            }
          }
          
          if (mixer) mixer.update(dt);
        }

        // Camera follow player (Smooth)
        const camOffset = new THREE.Vector3(0, 2, 5);
        camOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        
        const idealCamPos = new THREE.Vector3().copy(playerBody.interpolatedPosition as any).add(camOffset);
        cameraPosition.lerp(idealCamPos, 0.2);
        camera.position.copy(cameraPosition);

        cameraTarget.lerp(new THREE.Vector3(playerBody.interpolatedPosition.x, playerBody.interpolatedPosition.y + 1, playerBody.interpolatedPosition.z), 0.2);
        camera.lookAt(cameraTarget);

        // Minimap update
        minimapCamera.position.set(playerBody.interpolatedPosition.x, 100, playerBody.interpolatedPosition.z);
        minimapCamera.lookAt(playerBody.interpolatedPosition.x, 0, playerBody.interpolatedPosition.z);

        // Interaction UI
        let canEnter = false;
        for (const v of vehicles) {
          if (playerBody.position.distanceTo(v.chassisBody.position) < 4) {
            canEnter = true;
            break;
          }
        }
        if (canEnter) {
          setUiText('Нажмите E (или 🚗), чтобы сесть в транспорт');
        } else {
          setUiText('Нажмите V, чтобы заспавнить машину');
        }
      }

      // --- DRIVING LOGIC ---
      if (gameState === 'driving' && currentVehicle) {
        const engineForce = keys['ShiftLeft'] ? 3000 : 1500; // Nitro!
        const maxSteerVal = 0.5;
        
        const driveInput = (keys['KeyW'] ? -1 : 0) + (keys['KeyS'] ? 1 : 0) + (joystickActive ? joystickVector.y : 0);
        const steerInput = (keys['KeyA'] ? -1 : 0) + (keys['KeyD'] ? 1 : 0) + (joystickActive ? joystickVector.x : 0);

        if (driveInput < -0.1) {
          currentVehicle.vehicle.applyEngineForce(-engineForce * Math.abs(driveInput), 2);
          currentVehicle.vehicle.applyEngineForce(-engineForce * Math.abs(driveInput), 3);
        } else if (driveInput > 0.1) {
          currentVehicle.vehicle.applyEngineForce(engineForce * Math.abs(driveInput), 2);
          currentVehicle.vehicle.applyEngineForce(engineForce * Math.abs(driveInput), 3);
        } else {
          currentVehicle.vehicle.applyEngineForce(0, 2);
          currentVehicle.vehicle.applyEngineForce(0, 3);
        }

        if (steerInput < -0.1) {
          currentVehicle.vehicle.setSteeringValue(maxSteerVal * Math.abs(steerInput), 0);
          currentVehicle.vehicle.setSteeringValue(maxSteerVal * Math.abs(steerInput), 1);
        } else if (steerInput > 0.1) {
          currentVehicle.vehicle.setSteeringValue(-maxSteerVal * Math.abs(steerInput), 0);
          currentVehicle.vehicle.setSteeringValue(-maxSteerVal * Math.abs(steerInput), 1);
        } else {
          currentVehicle.vehicle.setSteeringValue(0, 0);
          currentVehicle.vehicle.setSteeringValue(0, 1);
        }
        
        // Brake
        if (keys['Space']) {
          currentVehicle.vehicle.setBrake(50, 0);
          currentVehicle.vehicle.setBrake(50, 1);
          currentVehicle.vehicle.setBrake(50, 2);
          currentVehicle.vehicle.setBrake(50, 3);
        } else {
          currentVehicle.vehicle.setBrake(0, 0);
          currentVehicle.vehicle.setBrake(0, 1);
          currentVehicle.vehicle.setBrake(0, 2);
          currentVehicle.vehicle.setBrake(0, 3);
        }

        // Camera follow car (Smooth)
        const carPos = currentVehicle.chassisBody.interpolatedPosition;
        const camOffset = new THREE.Vector3(0, 3, 8);
        camOffset.applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        
        const idealCamPos = new THREE.Vector3().copy(carPos as any).add(camOffset);
        cameraPosition.lerp(idealCamPos, 0.1);
        camera.position.copy(cameraPosition);

        cameraTarget.lerp(new THREE.Vector3(carPos.x, carPos.y + 1, carPos.z), 0.2);
        camera.lookAt(cameraTarget);
        
        // Minimap update
        minimapCamera.position.set(carPos.x, 100, carPos.z);
        minimapCamera.lookAt(carPos.x, 0, carPos.z);
        
        setUiText('Нажмите F (или 🚗), чтобы выйти');
        setSpeed(Math.round(currentVehicle.chassisBody.velocity.length() * 3.6)); // km/h
      } else {
        setSpeed(0);
      }

      // Sync Vehicle Meshes
      for (const v of vehicles) {
        v.carContainer.position.copy(v.chassisBody.interpolatedPosition as any);
        v.carContainer.quaternion.copy(v.chassisBody.interpolatedQuaternion as any);

        for (let i = 0; i < v.vehicle.wheelInfos.length; i++) {
          v.vehicle.updateWheelTransform(i);
          const t = v.vehicle.wheelInfos[i].worldTransform;
          v.wheelBodies[i].position.copy(t.position);
          v.wheelBodies[i].quaternion.copy(t.quaternion);
          v.wheelMeshes[i].position.copy(t.position as any);
          v.wheelMeshes[i].quaternion.copy(t.quaternion as any);
        }
      }

      // Render Main Scene
      renderer.setRenderTarget(minimapRenderTarget);
      renderer.clear();
      renderer.render(scene, minimapCamera);

      renderer.setRenderTarget(null);
      renderer.clear();
      composer.render();

      // Render HUD
      renderer.clearDepth();
      renderer.render(hudScene, hudCamera);
    };
    
    animate();

    // --- RESIZE ---
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);

      hudCamera.left = -window.innerWidth / 2;
      hudCamera.right = window.innerWidth / 2;
      hudCamera.top = window.innerHeight / 2;
      hudCamera.bottom = -window.innerHeight / 2;
      hudCamera.updateProjectionMatrix();

      minimapMesh.position.set(window.innerWidth / 2 - 120, -window.innerHeight / 2 + 120, 0);
      borderMesh.position.copy(minimapMesh.position);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mount.removeChild(renderer.domElement);
      if (joystickZone.parentNode) mount.removeChild(joystickZone);
      if (actionBtn.parentNode) mount.removeChild(actionBtn);
      if (jumpBtn.parentNode) mount.removeChild(jumpBtn);
    };
  }, []);

  return (
    <>
      {loading && <LoadingScreen progress={progress} />}
      <div ref={mountRef} style={{ width: '100vw', height: '100vh', overflow: 'hidden' }} />
      
      {/* HUD */}
      {!loading && (
        <div className="absolute top-4 left-4 text-white font-mono text-lg drop-shadow-md pointer-events-none">
          <div className="bg-black/50 p-4 rounded-xl border border-white/10 backdrop-blur-sm">
            <p className="text-green-400 font-bold text-3xl">${score}</p>
          </div>
        </div>
      )}
      
      {/* Interaction Prompt */}
      {uiText && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-6 py-3 rounded-full font-bold text-xl pointer-events-none border border-white/20 backdrop-blur-sm">
          {uiText}
        </div>
      )}
      
      {/* Crosshair */}
      {!loading && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full pointer-events-none mix-blend-difference" />
      )}
      
      {/* Speedometer */}
      {!loading && speed > 0 && (
        <div className="absolute bottom-5 right-[240px] bg-black/50 text-white p-4 rounded-xl font-mono text-2xl font-bold pointer-events-none border-2 border-white/20 backdrop-blur-sm">
          {speed} <span className="text-sm text-gray-400">км/ч</span>
        </div>
      )}
    </>
  );
}
