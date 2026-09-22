import React, { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Html, RoundedBox, useGLTF } from '@react-three/drei';
import { Box3, Vector3 } from 'three';

const plots = [[.45,.65],[1.6,.2],[.75,-.65],[2.45,1.05],[1.25,1.8],[2.1,-1],[-.25,-1.3],[-.3,2.4],[2.8,-.2]];

// Normalize source dimensions and pivots, sharing cached geometry and textures.
function Nature({ name, position=[0,0,0], size=1, width=false, rotation=0 }) {
  const { scene } = useGLTF(`/garden-assets/nature/${name}.gltf`);
  const model = useMemo(() => {
    const clone=scene.clone(true);
    const bounds=new Box3().setFromObject(clone);
    const extent=bounds.getSize(new Vector3());
    const center=bounds.getCenter(new Vector3());
    const factor=size/Math.max(width?Math.max(extent.x,extent.z):extent.y,.001);
    clone.position.set(-center.x*factor,-bounds.min.y*factor,-center.z*factor);
    clone.scale.setScalar(factor);
    clone.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    return clone;
  },[scene,size,width]);
  return <group position={position} rotation={[0,rotation,0]}><primitive object={model} dispose={null}/></group>;
}

function Ground() {
  // Only shadows are rendered: the meadow in the backdrop is the visible ground.
  return <mesh rotation={[-Math.PI/2,0,0]} position={[0,.01,0]} receiveShadow>
    <planeGeometry args={[24,24]}/><shadowMaterial transparent opacity={.2} depthWrite={false}/>
  </mesh>;
}

function Bench() {
  return <group position={[-.15,.06,-2.35]} rotation={[0,-.12,0]}>
    {[-.45,.45].map(x=><mesh key={x} position={[x,.23,0]} castShadow><boxGeometry args={[.1,.46,.48]}/><meshStandardMaterial color="#6d6249"/></mesh>)}
    {[0,1,2].map(i=><RoundedBox key={i} args={[1.3,.08,.17]} radius={.025} position={[0,.47,(i-1)*.19]} castShadow><meshStandardMaterial color="#c39362"/></RoundedBox>)}
    {[.73,.96].map(y=><RoundedBox key={y} args={[1.3,.17,.07]} radius={.025} position={[0,y,-.27]} castShadow><meshStandardMaterial color="#bd8b5a"/></RoundedBox>)}
  </group>;
}

function Planting({ object,index,selected,onSelect }) {
  const [x,z]=plots[index];
  const active=selected===object.id;
  const speciesModels={animals:'CommonTree_5',people:'Flower_3_Group',elderly:'CommonTree_3',ecology:'Bush_Common_Flowers',education:'CommonTree_5',donation:'Flower_4_Group',neighborhood:'Bush_Common_Flowers'};
  const plant=object.seed?'Plant_1':speciesModels[object.species]||'Flower_3_Group';
  const size=object.seed ? .6 : plant.startsWith('CommonTree') ? 1.35 : .72;
  return <group position={[x,.07,z]} onClick={event=>{event.stopPropagation();onSelect(object.id);}}>
    <Nature name={plant} size={size} position={[0,.05,0]} rotation={index*.83}/>
    {active&&<mesh position={[0,.035,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.44,.48,40]}/><meshBasicMaterial color="#f2cc78" transparent opacity={.7}/></mesh>}
    <mesh position={[0,.5,0]}><cylinderGeometry args={[.48,.48,1,12]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
    {active&&<Html center position={[0,size+.3,0]} style={{pointerEvents:'none'}}><span className="garden-plant-label">{object.seed?'Твой первый росток':'Растёт благодаря тебе'}</span></Html>}
  </group>;
}

function Landscape() {
  return <>
    {[[-2.65,-2,2.75,'CommonTree_3'],[-1.25,-3.2,2.2,'CommonTree_5'],[1.3,-3,2.65,'CommonTree_3'],[2.75,-2,2.3,'Pine_5'],[-3.55,-.7,1.7,'CommonTree_5']].map(([x,z,size,name],i)=><Nature key={`tree-${i}`} name={name} size={size} position={[x,.06,z]} rotation={i*1.3}/>)}
    {[[-3.15,1.7,.64],[3.25,.7,.62],[-2.45,-2.8,.75],[2.55,-2.7,.68],[.25,-3.4,.68]].map(([x,z,size],i)=><Nature key={`bush-${i}`} name="Bush_Common_Flowers" size={size} position={[x,.06,z]} rotation={i}/>)}
    {[[-2.5,2.5],[-1.6,2.85],[2.2,2.5],[3.25,-.7],[-.65,-2.75],[.7,-2.8]].map(([x,z],i)=><Nature key={`flower-${i}`} name={i%2?'Flower_3_Group':'Flower_4_Group'} size={.35} position={[x,.06,z]} rotation={i}/>)}
    {[[-3.1,.8],[-2.8,-1.2],[2.9,1.7],[1.9,-2.5]].map(([x,z],i)=><Nature key={`fern-${i}`} name="Fern_1" width size={.65} position={[x,.06,z]} rotation={i}/>)}
    {[[-2.8,-1.8],[2.7,-1.4],[-2.3,2.1]].map(([x,z],i)=><Nature key={`mushroom-${i}`} name="Mushroom_Common" size={.22} position={[x,.06,z]} rotation={i}/>)}
    {Array.from({length:22},(_,i)=>{const a=i*2.399,r=3.5+(i%3)*.15;return <Nature key={`grass-${i}`} name="Grass_Common_Short" size={.18+(i%3)*.04} position={[Math.cos(a)*r,.06,Math.sin(a)*r]} rotation={a}/>;})}
    {[[0,3.75],[.05,3.15],[-.4,2.65],[-.7,2.1],[-.65,1.5],[-.55,.85],[-.4,.2],[-.55,-.45],[-.7,-1.1],[-.35,-1.7]].map(([x,z],i)=><Nature key={`path-${i}`} name="RockPath_Round_Small_1" width size={.54} position={[x,.055,z]} rotation={i*.65}/>)}
    <Bench/>
  </>;
}

function CameraFit() {
  const {camera,size}=useThree();
  useEffect(()=>{
    // Match the cover-scaled portrait backdrop; keep objects on its central clearing.
    const backdropWidth=Math.max(size.width,size.height*2/3);
    camera.zoom=Math.min(backdropWidth/15,size.width/9.8,size.height/9);
    camera.lookAt(0,0,0);
    camera.updateProjectionMatrix();
  },[camera,size]);
  return null;
}

export default function GardenScene({objects=[],selected,onSelect}) {
  const visible=objects.length?objects.slice(0,9):[{id:'seed',seed:true}];
  return <div className="garden-3d" aria-label="Интерактивный 3D-сад">
    <Canvas shadows orthographic gl={{alpha:true}} dpr={[1,1.5]} camera={{position:[5,10,11],near:.1,far:60}}>
      <hemisphereLight args={['#fff5dd','#a7b77b',2.6]}/>
      <directionalLight position={[-3,8,-4]} intensity={1.7} color="#fff1d4" castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-normalBias={.04} shadow-radius={4}/>
      <CameraFit/>
      <Suspense fallback={<Html center><span className="garden-plant-label">Высаживаем сад…</span></Html>}>
        <Ground/><Landscape/>
        {visible.map((object,index)=><Planting key={object.id} object={object} index={index} selected={selected} onSelect={onSelect}/>)}
      </Suspense>
    </Canvas>
  </div>;
}
