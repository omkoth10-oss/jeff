import * as THREE from 'three';
import { createRig, frameRotation } from './rig.js';
import { createGait, runBlend, TOE_OUT } from './gait.js';
import { createSpring, createSpring3, createSecondary } from './springs.js';

// The ninja's animation, built every frame from the player's movement (no clips).
//
//  legs     gait.js decides where each foot is: planted feet are locked to the ground,
//           swinging feet follow arcs to predicted footholds. Each leg is solved with
//           two-bone IK (law of cosines, knee toward the toes), the foot rolls heel ->
//           flat -> ball -> toe and lies on the ground's slope; the toes stay flat while
//           the heel is up.
//  pelvis   as high as the planted legs allow with soft knees (it vaults over the
//           stance leg when walking; a spring-mass bounce with a flight phase when
//           running), sways over the supporting foot, drops on the swing side and turns
//           with the stepping legs.
//  torso    counter-rotates against the pelvis, leans into acceleration, turns and
//           sprints, breathes (faster after running); the head stays steady, leads with
//           the camera's direction a little and glances around when idle.
//  arms     swing opposite the legs through damped springs (lag and a little
//           overshoot), elbows bend more with speed.
//  air      crouch before the jump, extension at take-off, knees tucked while rising,
//           legs reaching for the ground while falling, arms out for balance on long
//           falls; landings absorb the impact, deeper for harder landings.
//  water    wading: slower, higher steps, knees up, arms lifted clear of the water.
//  cloth    springs on the sword, hood and coat panels (springs.js).

const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp, smooth = THREE.MathUtils.smoothstep;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function createProceduralAnimator({ root, model, ground }) {
  root.updateMatrixWorld(true);
  const rig = createRig(root, model);
  const B = rig.bones;
  const S = rig.rootScale; // world metres per model unit
  const rc = (k) => rig.restChar.get(B[k]).p;
  const rq = (k) => rig.restChar.get(B[k]).q;
  const gait = createGait({ ground });
  const secondary = createSecondary(rig);

  // body measurements (world metres)
  const L1 = rig.lengths.thigh * S, L2 = rig.lengths.calf * S;
  const LEG = L1 + L2;
  const ANKLE_H = rc('footL').y * S;
  const BALL = Math.hypot(rc('toeL').x - rc('footL').x, rc('toeL').z - rc('footL').z) * S;
  const HEEL = 0.06 * S;
  const thighOff = [rc('thighL').clone().sub(rc('hip')).multiplyScalar(S), rc('thighR').clone().sub(rc('hip')).multiplyScalar(S)];
  const SIDES = [
    { s: 1, thigh: B.thighL, calf: B.calfL, foot: B.footL, toe: B.toeL, clav: B.clavL, arm: B.armL, fore: B.foreL, hand: B.handL, i1: B.indexL1, i2: B.indexL2, t1: B.thumbL1, footQ: rq('footL'), toeQ: rq('toeL') },
    { s: -1, thigh: B.thighR, calf: B.calfR, foot: B.footR, toe: B.toeR, clav: B.clavR, arm: B.armR, fore: B.foreR, hand: B.handR, i1: B.indexR1, i2: B.indexR2, t1: B.thumbR1, footQ: rq('footR'), toeQ: rq('toeR') },
  ];
  // each foot's rest heading in character space (the model stands with its toes out)
  for (const [i, k] of [[0, 'L'], [1, 'R']]) {
    const d = rc('toe' + k).clone().sub(rc('foot' + k));
    SIDES[i].restHeading = new THREE.Vector3(d.x, 0, d.z).normalize();
  }
  // knee flexion -> hip-to-ankle distance
  const legSpan = (flex) => Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(flex));

  // ---- state
  const body = { vy: 0, pos: new THREE.Vector3(), prev: null, vel: new THREE.Vector3(), speed: 0, facing: 0, prevFacing: 0, turn: 0, heading: 0, headingRate: 0, accel: 0, fwdSpeed: 0 };
  const sp = {
    hipY: createSpring(18, 1), // pelvis height offset from the stand height
    side: createSpring(9, 0.85), // sideways sway over the supporting foot
    land: createSpring(9, 1), // landing compression (metres, negative)
    lean: createSpring(11, 0.8), // forward lean (radians)
    drive: createSpring(22, 1), // lean from the push (radians)
    bank: createSpring(6, 0.9), // lean into turns
    headYaw: createSpring(6, 1), headPitch: createSpring(6, 1),
    armL: createSpring(13, 0.55), armR: createSpring(13, 0.55), // shoulder flexion
    elbowL: createSpring(10, 0.75), elbowR: createSpring(10, 0.75),
    abd: createSpring(8, 0.8), // arm abduction (both)
    exert: createSpring(0.35, 1), // how hard he's been running (breathing)
  };
  const air = { on: false, time: 0, lead: 0, jump: false, jumpAt: -9, feet: [createSpring3(16, 0.8), createSpring3(16, 0.8)], pitch: [createSpring(14, 0.9), createSpring(14, 0.9)] };
  const feetOut = [{}, {}].map(() => ({ ankle: new THREE.Vector3(), q: new THREE.Quaternion(), toeFlat: 0, planted: true, pitch: 0, lastSwing: null, startCorr: new THREE.Vector3(), jump: new THREE.Vector3() }));
  let time = 0, idleSeed = Math.random() * 100, prevLanded = 1e9;

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  const F = new THREE.Vector3(), L = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qI = new THREE.Quaternion();
  const qPelvis = new THREE.Quaternion(), qChest = new THREE.Quaternion(), qFacing = new THREE.Quaternion();
  const axisQ = (axis, angle, out = new THREE.Quaternion()) => out.setFromAxisAngle(axis, angle);
  const frac = (q, t, out) => out.copy(qI).slerp(q, t);

  // foot on the ground: ankle position for a footprint (ground point under the ankle when
  // flat), heading, ground normal and pitch (+ toes up: rolls on the heel; - heel up:
  // rolls on the ball of the foot)
  const fFlat = new THREE.Vector3(), fP = new THREE.Vector3(), uP = new THREE.Vector3(), fH = new THREE.Vector3();
  function footFrame(heading, normal, pitch) {
    fH.set(Math.sin(heading), 0, Math.cos(heading));
    fFlat.copy(fH).addScaledVector(normal, -fH.dot(normal)).normalize();
    fP.copy(fFlat).multiplyScalar(Math.cos(pitch)).addScaledVector(normal, Math.sin(pitch));
    uP.copy(normal).multiplyScalar(Math.cos(pitch)).addScaledVector(fFlat, -Math.sin(pitch));
  }
  function rolledAnkle(anchor, heading, normal, pitch, out) {
    footFrame(heading, normal, pitch);
    if (pitch >= 0) out.copy(anchor).addScaledVector(fFlat, -HEEL).addScaledVector(fP, HEEL);
    else out.copy(anchor).addScaledVector(fFlat, BALL).addScaledVector(fP, -BALL);
    return out.addScaledVector(uP, ANKLE_H);
  }
  function footQuat(side, out) {
    // rest (flat, toes along restHeading in character space) -> world frame (uP, fP)
    frameRotation(UP, side.restHeading, uP, fP, q2);
    return out.copy(q2).multiply(side.footQ);
  }

  // two-bone IK: thigh -> knee -> ankle, knee toward `pole`
  const kneePos = new THREE.Vector3(), dirTA = new THREE.Vector3(), poleO = new THREE.Vector3();
  function solveLeg(side, ankle, pole) {
    const T = side.thigh.getWorldPosition(v2);
    dirTA.subVectors(ankle, T);
    let d = dirTA.length();
    dirTA.divideScalar(d || 1);
    d = clamp(d, Math.abs(L1 - L2) + 1e-3, LEG * 0.9995);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    poleO.copy(pole).addScaledVector(dirTA, -pole.dot(dirTA)).normalize();
    kneePos.copy(T).addScaledVector(dirTA, a).addScaledVector(poleO, h);
    rig.aim(side.thigh, side.calf, kneePos, poleO);
    v4.copy(T).addScaledVector(dirTA, d); // the ankle, or as close as the leg reaches
    rig.aim(side.calf, side.foot, v4, poleO);
  }

  // arm: shoulder flexion (forward +), abduction (out +), elbow flexion, in the chest frame
  const armDir = new THREE.Vector3(), armFront = new THREE.Vector3(), foreDir = new THREE.Vector3();
  function poseArm(side, flex, abd, elbow, chestQ) {
    const s = side.s;
    armDir.set(s * Math.sin(abd), -Math.cos(abd) * Math.cos(flex), Math.cos(abd) * Math.sin(flex)).applyQuaternion(chestQ);
    armFront.set(-s * 0.3, Math.sin(flex), Math.cos(flex)).applyQuaternion(chestQ);
    armFront.addScaledVector(armDir, -armFront.dot(armDir)).normalize();
    const sh = side.arm.getWorldPosition(v2);
    rig.aim(side.arm, side.fore, v1.copy(sh).add(armDir), armFront);
    foreDir.copy(armDir).multiplyScalar(Math.cos(elbow)).addScaledVector(armFront, Math.sin(elbow));
    const el = side.fore.getWorldPosition(v2);
    rig.pointAt(side.fore, side.hand, v1.copy(el).add(foreDir));
  }

  // where the ankles hang in the air, relative to the hip (character frame: x left, y up, z fwd)
  function airTarget(i, p, out) {
    const s = SIDES[i].s;
    const lead = i === air.lead ? 1 : -1;
    const run = air.run;
    if (air.time < 0.1 && p.vy > 0 && run < 0.4) {
      // take-off: legs extending, the trailing one pushing off behind
      return out.set(s * 0.1, -0.8, lead > 0 ? 0.05 : -0.22 * run - 0.04);
    }
    if (air.jump && p.vy > -1.2 && air.time < 1.2) {
      // rising and over the top: knees drawn up briefly at the apex; legs reach down
      // again as soon as he starts to drop. A running jump keeps its stride (lead thigh
      // up, the other folded behind), the trailing leg coming through as he drops
      const apex = 1 - smooth(Math.abs(p.vy), 0.4, 2.5);
      if (run > 0.4) {
        const through = smooth(-p.vy, -1.5, 1.2);
        return lead > 0 ? out.set(s * 0.11, -0.5 - 0.06 * through, 0.24) : out.set(s * 0.1, lerp(-0.42, -0.5, through), lerp(-0.3, 0.05, through));
      }
      return out.set(s * 0.11, lerp(-0.62, -0.48, apex), lead > 0 ? 0.12 : 0.05);
    }
    const falling = smooth(p.fallSpeed, 5, 9);
    if (falling > 0) {
      // a long fall: legs apart, slowly cycling
      const c = Math.sin(time * 3.2 + i * Math.PI);
      out.set(s * (0.12 + 0.06 * falling), -0.62, 0.05 + 0.14 * c * falling);
      return out;
    }
    // coming down: the leading leg reaches ahead for the ground, knee soft; on a running
    // jump the other trails bent behind
    return lead > 0 ? out.set(s * 0.11, -0.68, 0.1 + 0.14 * run) : out.set(s * 0.1, -0.7 + 0.12 * run, 0.02 - 0.2 * run);
  }

  return {
    rig,
    gait,
    secondary,
    body,
    // p: player state; view: { yaw, pitch } of the camera
    update(dt, p, view) {
      dt = Math.min(dt, 1 / 20);
      time += dt;
      rig.reset();
      root.updateMatrixWorld(true);

      // ---- body motion (from where the player really went)
      const pos = p.feet;
      if (!body.prev || body.prev.distanceTo(pos) > 3) {
        body.prev = pos.clone();
        body.vel.set(0, 0, 0);
        body.facing = body.prevFacing = body.heading = p.facing;
        gait.state.initialized = false;
        secondary.reset();
      }
      v1.subVectors(pos, body.prev).divideScalar(Math.max(dt, 1e-4));
      body.vy = approach(body.vy, p.grounded ? v1.y : 0, 6, dt);
      v1.y = 0;
      body.vel.lerp(v1, 1 - Math.exp(-18 * dt));
      body.prev.copy(pos);
      body.pos.copy(pos);
      body.speed = p.grounded ? p.speed : Math.hypot(body.vel.x, body.vel.z);
      body.turn = approach(body.turn, wrap(p.facing - body.prevFacing) / Math.max(dt, 1e-4), 10, dt);
      body.prevFacing = body.facing = p.facing;
      if (body.speed > 0.3) {
        const h = Math.atan2(body.vel.x, body.vel.z);
        body.headingRate = approach(body.headingRate, wrap(h - body.heading) / Math.max(dt, 1e-4), 8, dt);
        body.heading = h;
      } else body.headingRate = approach(body.headingRate, 0, 8, dt);
      F.set(Math.sin(p.facing), 0, Math.cos(p.facing));
      L.set(Math.cos(p.facing), 0, -Math.sin(p.facing));
      const fwdSpeed = body.vel.dot(F);
      body.accel = approach(body.accel, (fwdSpeed - body.fwdSpeed) / Math.max(dt, 1e-4), 6, dt);
      body.fwdSpeed = fwdSpeed;
      qFacing.setFromAxisAngle(UP, p.facing);

      const v = body.speed;
      const r = runBlend(v);
      const sprint = smooth(v, 4.6, 7.0);
      const wade = p.wading;
      const inAir = !p.grounded && (p.airTime > 0.1 || p.vy > 0.5);
      sp.exert.step(r * (0.6 + 0.4 * sprint), dt);

      // ---- air
      if (p.jumped) air.jumpAt = time;
      if (inAir && !air.on) {
        air.on = true;
        air.time = 0;
        air.run = r;
        air.jump = time - (air.jumpAt ?? -9) < 0.3; // jumped, or stepped off / dropped
        // the foot further ahead leads the tuck
        air.lead = feetOut[0].ankle.dot(F) >= feetOut[1].ankle.dot(F) ? 0 : 1;
      }
      let justLanded = false;
      if (!inAir && air.on) {
        air.on = false;
        justLanded = true;
      }
      if (air.on) air.time += dt;

      // landing: compress by the impact, recover (slower after a harder landing)
      if (p.landed < prevLanded && p.landed < 0.1 && p.impact > 0) {
        const hard = clamp((p.impact - 3) / 9, 0, 1);
        const depth = (0.1 + 0.3 * hard) * (1 - 0.45 * r); // knees ~90 degrees after a big jump, a deep squat after a long drop
        sp.land.omega = lerp(9, 6, hard);
        sp.land.v -= depth * sp.land.omega * Math.E;
      }
      prevLanded = p.landed;

      // ---- feet
      const airFeet = justLanded ? feetOut.map((f) => v3.copy(f.ankle).addScaledVector(UP, -ANKLE_H).clone()) : null;
      gait.update({ pos, vel: body.vel, speed: v, accel: body.accel, facing: p.facing, turnRate: body.turn, air: air.on, airFeet, wading: wade, dt });
      const hipRestY = rig.restChar.get(B.hip).p.y * S;
      gait.feet.forEach((ft, i) => {
        const o = feetOut[i];
        const side = SIDES[i];
        const prevAnkle = v4.copy(o.ankle);
        if (air.on) {
          // hanging below the hip, springs toward the air pose
          const t = airTarget(i, p, v1);
          const sprIn = air.feet[i];
          if (air.time <= dt * 1.01) {
            // start from where the ankle is now, relative to the hip
            v2.subVectors(o.ankle, v3.copy(pos).addScaledVector(UP, hipRestY)).applyQuaternion(q1.copy(qFacing).invert());
            sprIn.reset(v2);
          }
          sprIn.step(t, dt);
          o.ankle.copy(sprIn.x).applyQuaternion(qFacing).add(pos).addScaledVector(UP, hipRestY);
          // toes pointed off the ground, then ready to land on the balls of the feet
          const pitchT = air.time < 0.12 && p.vy > 0 ? -40 * DEG : p.vy > 0 ? -12 * DEG : -10 * DEG;
          if (air.time <= dt * 1.01) air.pitch[i].reset(o.pitch);
          o.pitch = air.pitch[i].step(pitchT, dt);
          footFrame(p.facing + side.s * TOE_OUT, UP, o.pitch);
          footQuat(side, o.q);
          o.toeFlat = 0;
          o.planted = false;
          o.jump.set(0, 0, 0);
          return;
        }
        const pitchT = ft.pitch * DEG;
        o.pitch = approach(o.pitch, pitchT, gait.state.moving ? 45 : 14, dt);
        if (ft.planted) {
          rolledAnkle(ft.anchor, ft.yaw, ft.normal, o.pitch, o.ankle);
          footQuat(side, o.q);
          o.toeFlat = o.pitch < 0 ? 1 : 0;
          o.planted = true;
          o.lastSwing = null;
        } else {
          const s = ft.swing;
          if (o.lastSwing !== s) {
            // new step: start from where the ankle was (the heel was up), not the footprint
            o.startCorr.copy(prevAnkle).sub(v1.copy(s.from).addScaledVector(ft.normal, ANKLE_H));
            if (o.startCorr.length() > 0.6) o.startCorr.set(0, 0, 0);
            o.lastSwing = s;
          }
          const heading = gait.swingPose(ft, v1);
          const u = clamp(s.t / s.dur, 0, 1);
          const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
          v2.copy(ft.normal).lerp(s.toNormal, e).normalize();
          // end: the ankle where the heel-strike roll will put it
          rolledAnkle(v3.set(0, 0, 0), heading, v2, o.pitch, v3).addScaledVector(v2, -ANKLE_H);
          o.ankle.copy(v1).addScaledVector(v2, ANKLE_H).addScaledVector(o.startCorr, 1 - e).addScaledVector(v3, e);
          footQuat(side, o.q);
          o.toeFlat = u < 0.15 && o.pitch < 0 ? 1 - u / 0.15 : 0;
          o.planted = false;
        }
        // blend out jumps in the ankle's path (landing, teleports)
        if (justLanded) o.jump.subVectors(prevAnkle, o.ankle);
        o.jump.multiplyScalar(Math.exp(-16 * dt));
        o.ankle.add(o.jump);
      });

      // ---- pelvis orientation
      const aL = feetOut[0].ankle, aR = feetOut[1].ankle;
      const stepSpread = v1.subVectors(aL, aR).dot(F); // + when the left foot is ahead
      const moving = gait.state.moving && !air.on;
      const swingL = !feetOut[0].planted && !air.on ? Math.sin(Math.PI * clamp(gait.feet[0].swing ? gait.feet[0].swing.t / gait.feet[0].swing.dur : 0, 0, 1)) : 0;
      const swingR = !feetOut[1].planted && !air.on ? Math.sin(Math.PI * clamp(gait.feet[1].swing ? gait.feet[1].swing.t / gait.feet[1].swing.dur : 0, 0, 1)) : 0;
      // idle: weight shifts from foot to foot every several seconds, and a little sway
      const idle = 1 - smooth(v, 0.1, 0.8);
      const it = time + idleSeed;
      // (weight held on one leg for several seconds, then shifted over to the other)
      const shift = idle * (0.04 * Math.tanh(3 * Math.sin(it * (2 * Math.PI / 7.5) + 0.5 * Math.sin(it * 0.17))) + 0.005 * Math.sin(it * 1.9));
      const pelvisYaw = clamp(-0.13 * stepSpread, -0.16, 0.16) * (air.on ? 0.4 : 1) + idle * 0.05 * Math.sin(it * 0.29);
      // the ground's grade along his path (+ uphill): stairs and slopes
      const grade = clamp(body.vy / Math.max(v, 0.6), -1, 1);
      const hipDrop = lerp(4.5, 3, r) * DEG;
      const bankT = clamp(-Math.atan((v * body.headingRate) / 9.8) * 0.7, -0.35, 0.35) * (air.on ? 0.3 : 1);
      const bank = sp.bank.step(moving ? bankT : 0, dt);
      const pelvisRoll = -hipDrop * swingL + hipDrop * swingR + (shift / 0.04) * 6 * DEG + bank * 0.6;
      // lean: forward with speed and sprinting, into acceleration, back when braking
      // jump: sink into a squat, then drive up through hips, knees and ankles before the
      // feet leave the ground
      const crouch = p.crouch ?? 0;
      const squat = crouch > 0 ? Math.sin(Math.PI * Math.pow(crouch, 1.15)) : 0;
      const landC = sp.land.step(0, dt); // negative when compressed
      // lean: forward with speed and sprinting, hard into acceleration, back when braking,
      // into the climb on stairs and slopes
      // (+3 degrees: the model's rest spine leans back slightly)
      // (into the push he's making as he speeds up or brakes: in step with it, from the
      // ankles, not after it)
      const drive = sp.drive.step(clamp((p.drive ?? 0) * 0.15, -0.24, 0.45) * (air.on ? 0 : 1), dt);
      const leanT = (3 + lerp(3.5, 11, r) + 4 * sprint) * DEG
        + 38 * DEG * squat + (air.on ? (p.vy > 0 ? 6 : -2 * smooth(p.fallSpeed, 5, 9)) * DEG : 0) + wade * 8 * DEG
        + (moving ? (grade > 0 ? grade * 0.4 : grade * 0.08) : 0);
      const lean = sp.lean.step(leanT, dt) + drive + clamp(-landC * 2.2, 0, 0.9);
      const pelvisTilt = lean * 0.15 + r * 1 * DEG;
      qPelvis.copy(axisQ(UP, pelvisYaw, q1)).multiply(axisQ(F, pelvisRoll, q2)).multiply(axisQ(L, pelvisTilt, q2));

      // ---- pelvis position
      const support = v2.set(0, 0, 0);
      let nPlanted = 0;
      feetOut.forEach((o) => {
        if (o.planted && !air.on) {
          support.add(o.ankle);
          nPlanted++;
        }
      });
      const sideT = nPlanted ? support.divideScalar(nPlanted).sub(pos).dot(L) * lerp(0.3, 0.15, r) : 0;
      const sway = sp.side.step(sideT + shift, dt) + Math.sin(bank) * 0.5;
      const hip = v3.copy(pos).addScaledVector(L, sway).addScaledVector(F, Math.sin(lean) * 0.18 - 0.02 * crouch);
      // height: planted legs with soft knees (walking vaults over them), or a
      // spring-mass bounce while running; never higher than the legs can reach
      const qp = q1.copy(qPelvis).multiply(qFacing);
      const offs = thighOff.map((t) => t.clone().applyQuaternion(qp));
      const reachY = (i, span) => {
        const a = feetOut[i].ankle, o = offs[i];
        const dx = hip.x + o.x - a.x, dz = hip.z + o.z - a.z;
        return a.y - o.y + Math.sqrt(Math.max(0, span * span - dx * dx - dz * dz));
      };
      const flex = (lerp(7, 11, smooth(v, 0.2, 1.4)) + wade * 22) * DEG; // soft knees
      // (a foot about to push off carries little weight: only the hard limit below)
      let walkY = Infinity;
      feetOut.forEach((o, i) => {
        if (o.planted && !air.on && (!moving || gait.feet[i].stance < 0.75)) walkY = Math.min(walkY, reachY(i, legSpan(flex)));
      });
      const standY = pos.y + hipRestY - 0.01;
      if (walkY === Infinity) walkY = standY;
      // running: lower, knees bent (they compress through the stance), lowest mid-stance,
      // highest mid-flight
      let bounce = 0;
      if (moving) {
        for (const ft of gait.feet) if (ft.planted) bounce = Math.min(bounce, -Math.sin(Math.PI * ft.stance) * 0.025);
        if (!gait.feet[0].planted && !gait.feet[1].planted) bounce = 0.03;
      }
      const runY = pos.y + hipRestY - lerp(0.03, 0.025, sprint) + bounce; // (runners run tall)
      let hipY = air.on ? pos.y + hipRestY + (p.vy > 0 ? 0.03 : 0) : lerp(walkY, runY, r);
      // on stairs and slopes the pelvis rises and falls smoothly with the climb instead of
      // in steps (the knees take up the difference)
      if (!air.on && moving) hipY = lerp(hipY, pos.y + hipRestY - 0.05, smooth(Math.abs(grade), 0.12, 0.45) * 0.7);
      hipY -= wade * 0.05;
      // (the jump's crouch and landings are quick: applied directly, not smoothed)
      const sm = sp.hipY.step(hipY - pos.y, dt) + pos.y - 0.28 * squat + landC;
      // hard limit: planted legs must reach their ankles, a swinging leg as it comes down
      let limit = Infinity;
      if (!air.on) {
        for (let i = 0; i < 2; i++) {
          const ft = gait.feet[i];
          const w = ft.planted ? 1 : smooth(ft.swing ? ft.swing.t / ft.swing.dur : 0, 0.6, 0.97);
          if (w > 0) limit = Math.min(limit, reachY(i, LEG * 0.999) + (1 - w) * 0.25);
        }
      }
      // (but never into a heap: if a foot can't be reached it comes off the ground)
      hip.y = Math.max(Math.min(sm, limit), pos.y + hipRestY - 0.3);
      rig.setWorldPosition(B.hip, hip);
      rig.rotateWorld(B.hip, qPelvis);

      // ---- spine: counter-rotation, lean, bank, breathing
      // (and leads into turns, ahead of the hips)
      const turnLead = clamp(body.turn * 0.06, -0.15, 0.15);
      const chestYaw = clamp((0.16 + 0.04 * r) * stepSpread, -0.26, 0.26) * (air.on ? 0.3 : 1) + turnLead;
      const chestRoll = -pelvisRoll * 0.75 + bank * 0.4;
      qChest.copy(axisQ(UP, chestYaw, q1)).multiply(axisQ(F, chestRoll, q2)).multiply(axisQ(L, lean, q2));
      const qSpine = q1.copy(qChest).multiply(q2.copy(qPelvis).invert());
      rig.rotateWorld(B.waist, frac(qSpine, 0.3, q2));
      rig.rotateWorld(B.spine1, frac(qSpine, 0.35, q2));
      rig.rotateWorld(B.spine2, frac(qSpine, 0.35, q2));
      // breathing: slow and small at rest, quicker and deeper after running
      const ex = sp.exert.x;
      const breathRate = lerp(0.24, 0.62, ex);
      const breath = Math.sin((time + idleSeed) * 2 * Math.PI * breathRate);
      const bAmp = lerp(2, 3, ex) * DEG * (moving ? 0.4 : 1);
      rig.rotateWorld(B.spine2, axisQ(L, -breath * bAmp, q2));

      // ---- head: steady (only part of the lean), toward where the camera looks
      const lookHeading = view ? view.yaw + Math.PI : p.facing;
      const diff = wrap(lookHeading - p.facing);
      const lookW = 1 - smooth(Math.abs(diff), 100 * DEG, 145 * DEG);
      const glance = idle * (10 * DEG * Math.sin(it * 0.37) + 4 * DEG * Math.sin(it * 0.91));
      // the head turns first, toward where he's going
      const headLead = clamp(wrap(body.heading - p.facing) * smooth(v, 0.3, 1) * 0.6 + body.turn * 0.12, -0.6, 0.6);
      const headYaw = sp.headYaw.step(clamp(diff * 0.45, -35 * DEG, 35 * DEG) * lookW + glance + headLead, dt);
      const headPitch = sp.headPitch.step((view ? clamp((-view.pitch - 0.2) * 0.35, -12 * DEG, 14 * DEG) : 0) + idle * 3 * DEG * Math.sin(it * 0.23), dt);
      const qHead = q1.copy(axisQ(UP, headYaw, q1)).multiply(axisQ(L, headPitch + lean * 0.3 + breath * bAmp * 0.3 + clamp(-landC, 0, 0.3) * 0.4, q2));
      const qNeck = q2.copy(qHead).multiply(new THREE.Quaternion().copy(qChest).invert());
      const part = new THREE.Quaternion();
      rig.rotateWorld(B.neck1, frac(qNeck, 0.3, part));
      rig.rotateWorld(B.neck2, frac(qNeck, 0.3, part));
      rig.rotateWorld(B.head, frac(qNeck, 0.4, part));

      // ---- legs
      for (let i = 0; i < 2; i++) {
        const side = SIDES[i], o = feetOut[i];
        // knee toward the toes, a little outward; in the air, forward
        const ft = gait.feet[i];
        // (only a planted leg's knee tracks a little outward, over the toes; a swinging
        // knee drives straight forward)
        const heading = air.on ? p.facing : ft.planted ? ft.yaw : p.facing;
        v1.set(Math.sin(heading), 0, Math.cos(heading)).lerp(F, 0.5).addScaledVector(L, ft.planted && !air.on ? side.s * 0.04 : 0).normalize();
        solveLeg(side, o.ankle, v1);
        rig.setWorld(side.foot, o.q);
        if (o.toeFlat > 0) {
          // toes stay flat on the ground while the heel lifts
          footFrame(ft.yaw, ft.normal, 0);
          footQuat(side, q1);
          q1.multiply(q2.copy(side.footQ).invert().multiply(side.toeQ)); // the toes of a flat foot
          rig.worldQuat(side.toe, q2);
          rig.setWorld(side.toe, q2.slerp(q1, o.toeFlat));
        }
      }

      // ---- arms
      const chestQ = q1.copy(qChest).multiply(qFacing);
      const swingAmp = lerp(lerp(0.42, 0.75, r), 1.0, sprint) * (moving ? smooth(v, 0.2, 1.2) : 0) * (1 - 0.6 * wade);
      const phi = gait.state.phase;
      // opposite arm to leg: the left arm is furthest forward as the right foot lands.
      // The target leads by the arm springs' phase lag at this cadence, so the arms
      // (which lag and overshoot like pendulums) stay in time with the legs
      const wd = 2 * Math.PI * gait.state.cadence;
      const lag = Math.atan2(2 * sp.armL.zeta * sp.armL.omega * wd, sp.armL.omega ** 2 - wd * wd) / (2 * Math.PI);
      // (the left foot lands at phase = swingEnd, the right half a cycle later)
      const swingEnd = 1 - gait.state.duty;
      const ph = 2 * Math.PI * (phi + lag - swingEnd);
      const armMean = lerp(-0.08, -0.12, r);
      let flexL = armMean + swingAmp * Math.cos(ph + Math.PI);
      let flexR = armMean + swingAmp * Math.cos(ph);
      let elbowT = lerp(lerp(0.3, 1.3, r), 1.35, sprint) + wade * 1.0;
      let abdT = lerp(0.14, 0.2, r) + wade * 0.85;
      flexL += wade * 0.35;
      flexR += wade * 0.35;
      if (idle > 0.5) {
        flexL += 0.02 * breath;
        flexR += 0.02 * breath;
      }
      if (crouch > 0) {
        // gathering for the jump: arms swing back, then drive up to peak at take-off
        const back = crouch < 0.55 ? lerp(flexL, -0.85, crouch / 0.55) : lerp(-0.85, 2.4, (crouch - 0.55) / 0.45);
        flexL = flexR = back;
        elbowT = 0.4;
      }
      if (air.on) {
        // (dropping off something, the arms come up and out at once)
        const fall = air.jump ? smooth(p.fallSpeed, 4.5, 9) : smooth(p.fallSpeed, 1.5, 6);
        if (p.vy > 0 && air.run > 0.5) {
          // running jump: the arm opposite the leading leg drives forward
          const t = smooth(air.time, 0.1, 0.45);
          const fwdArm = lerp(1.3, 0.4, t), backArm = lerp(-0.6, 0.1, t);
          flexL = air.lead === 1 ? fwdArm : backArm;
          flexR = air.lead === 1 ? backArm : fwdArm;
          elbowT = lerp(1.2, 0.8, t);
          abdT = lerp(0.2, 0.35, t);
        } else if (p.vy > 0) {
          // arms swing up through the take-off, then drop out to the sides for balance
          const t = smooth(air.time, 0.05, 0.28);
          flexL = flexR = lerp(2.4, 0.15, t);
          elbowT = lerp(0.45, 0.55, t);
          abdT = lerp(0.15, 0.6, t);
        } else {
          const f = Math.sin(time * 4.1) * 0.25 * fall;
          flexL = 0.35 + f;
          flexR = 0.35 - f;
          elbowT = lerp(0.6, 0.5, fall);
          abdT = lerp(0.5, 1.15, fall);
        }
      }
      if (landC < -0.02) {
        // absorbing a landing: arms forward for balance; after a long drop they reach
        // down toward the ground
        const k = clamp(-landC / 0.2, 0, 1), deep = smooth(-landC, 0.2, 0.35);
        flexL = lerp(flexL, lerp(0.5, 0.95, deep), k);
        flexR = lerp(flexR, lerp(0.45, 0.85, deep), k);
        abdT = lerp(abdT, lerp(0.45, 0.3, deep), k);
        elbowT = lerp(elbowT, lerp(0.6, 0.25, deep), k);
      }
      // (quicker arms for the jump's drive)
      sp.armL.omega = sp.armR.omega = crouch > 0 || air.on ? 20 : 13;
      const fl = sp.armL.step(flexL, dt), fr = sp.armR.step(flexR, dt);
      const ab = sp.abd.step(abdT, dt);
      // elbows bend more as each arm comes forward and open as it swings back (sprinting)
      const eL = sp.elbowL.step(elbowT + 0.25 * Math.max(0, fl) * (0.4 + r) - (0.35 * r + 0.15 * sprint) * Math.max(0, -fl), dt);
      const eR = sp.elbowR.step(elbowT + 0.25 * Math.max(0, fr) * (0.4 + r) - (0.35 * r + 0.15 * sprint) * Math.max(0, -fr), dt);
      for (let i = 0; i < 2; i++) {
        const side = SIDES[i];
        const f = i === 0 ? fl : fr;
        // the shoulder girdle follows: rises with breathing and forward reach, rolls forward
        rig.rotateWorld(side.clav, q2.setFromAxisAngle(F, side.s * (0.6 * breath * bAmp + 0.08 * Math.max(0, f) + 0.05 * wade)).multiply(axisQ(UP, -side.s * 0.12 * f, new THREE.Quaternion())));
        poseArm(side, f, ab, i === 0 ? eL : eR, chestQ);
        // relaxed hands: fingers loosely curled, a firmer fist when running
        const c = lerp(0.35, 0.9, r);
        rig.curl(side.i1, -side.s * c);
        rig.curl(side.i2, -side.s * c * 1.1);
        rig.curl(side.t1, -side.s * c * 0.3);
        side.i1.updateMatrixWorld(true);
        side.t1.updateMatrixWorld(true);
      }

      // ---- cloth, hood, sword
      const thighDrive = [0, 1].map((i) => {
        const side = SIDES[i];
        const now = v1.subVectors(side.calf.getWorldPosition(v1), side.thigh.getWorldPosition(v2)).normalize().clone();
        const rest = rig.restChar.get(side.calf).p.clone().sub(rig.restChar.get(side.thigh).p).normalize().applyQuaternion(q1.copy(qPelvis).multiply(qFacing));
        return { now, rest, fwd: now.dot(v2.copy(F).applyQuaternion(qPelvis)) - rest.dot(v2) };
      });
      secondary.update(dt, (key) => {
        if (!key.startsWith('skirt')) return null;
        const i = key.endsWith('L') ? 0 : 1;
        const front = key[5] === 'F' ? 1 : -1;
        const t = thighDrive[i];
        const w = front > 0 ? 0.45 + 0.3 * Math.tanh(8 * t.fwd) : 0.3 - 0.2 * Math.tanh(8 * t.fwd);
        return frac(new THREE.Quaternion().setFromUnitVectors(t.rest, t.now), w, new THREE.Quaternion());
      });
    },
  };
}
