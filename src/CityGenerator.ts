import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class CityGenerator {
  scene: THREE.Scene;
  world: CANNON.World;
  blockSize: number = 40;
  roadWidth: number = 10;
  citySize: number = 5; // 5x5 blocks

  constructor(scene: THREE.Scene, world: CANNON.World) {
    this.scene = scene;
    this.world = world;
  }

  generate() {
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: new CANNON.Material('ground')
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.3 }),
      new THREE.MeshStandardMaterial({ color: 0x665544, roughness: 0.6 }),
    ];

    const totalSize = this.blockSize + this.roadWidth;
    const offset = (this.citySize * totalSize) / 2;

    for (let x = 0; x < this.citySize; x++) {
      for (let z = 0; z < this.citySize; z++) {
        // Skip center block for spawn area
        if (x === Math.floor(this.citySize / 2) && z === Math.floor(this.citySize / 2)) continue;

        const blockX = x * totalSize - offset;
        const blockZ = z * totalSize - offset;

        // Create sidewalk/block base
        const baseGeo = new THREE.BoxGeometry(this.blockSize, 0.5, this.blockSize);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.set(blockX, 0.25, blockZ);
        baseMesh.receiveShadow = true;
        this.scene.add(baseMesh);

        // Generate buildings on the block
        const numBuildings = Math.floor(Math.random() * 4) + 1;
        for (let i = 0; i < numBuildings; i++) {
          const bWidth = 10 + Math.random() * 10;
          const bDepth = 10 + Math.random() * 10;
          const bHeight = 10 + Math.random() * 40;

          const bx = blockX + (Math.random() - 0.5) * (this.blockSize - bWidth);
          const bz = blockZ + (Math.random() - 0.5) * (this.blockSize - bDepth);

          const mat = buildingMaterials[Math.floor(Math.random() * buildingMaterials.length)];
          const mesh = new THREE.Mesh(buildingGeo, mat);
          mesh.scale.set(bWidth, bHeight, bDepth);
          mesh.position.set(bx, bHeight / 2 + 0.5, bz);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.scene.add(mesh);

          const shape = new CANNON.Box(new CANNON.Vec3(bWidth / 2, bHeight / 2, bDepth / 2));
          const body = new CANNON.Body({ mass: 0, shape });
          body.position.set(bx, bHeight / 2 + 0.5, bz);
          this.world.addBody(body);
        }
      }
    }
  }
}
