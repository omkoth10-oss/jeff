import * as THREE from 'three';

// Foot placement for the procedural walk / run / sprint.
//
// Each foot is either planted (its footprint locked in world space: no sliding) or
// swinging along an arc from where it lifted to where it will land. While moving, a gait
// clock drives the steps: cadence, duty factor (how long a foot stays down), stride and
// foot clearance all follow the speed, as measured for people (walking 1.4 m/s: ~0.9
// cycles/s, feet down 62% of the time; running 4 m/s: ~1.4 cycles/s, 37%, with a flight
// phase). The landing spot is predicted from the body's velocity and turn rate at the
// moment of touchdown, then raycast onto the ground (step tops on stairs), and the arc
// is lifted over anything it passes (step edges). Standing still, a foot takes a small
// step when it's too far from where it should be (settling after a stop, turning on the
// spot). Landing from the air re-plants both feet under where they are.
//
// Everything is in world space; "fwd"/"left" are the character's axes.

const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
function table(pts) {
  return (v) => {
    if (v <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (v <= pts[i][0]) {
        const t = (v - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        return lerp(pts[i - 1][1], pts[i][1], t);
      }
    }
    return pts[pts.length - 1][1];
  };
}
export const cadence = table([[0, 0.8], [1.6, 1.1], [2.4, 1.22], [4.2, 1.45], [7.2, 1.98]]); // gait cycles per second
export const duty = table([[0, 0.64], [1.6, 0.61], [2.1, 0.52], [2.9, 0.4], [4.2, 0.3], [7.2, 0.21]]);
export const clearance = table([[0, 0.05], [1.6, 0.045], [2.4, 0.13], [4.2, 0.33], [7.2, 0.46]]);
export const halfWidth = table([[0, 0.11], [1.4, 0.095], [4.2, 0.085], [7.2, 0.065]]);
export const runBlend = table([[0, 0], [1.9, 0], [3.0, 1]]); // 0 walking .. 1 running

export const TOE_OUT = 0.1; // radians, feet turned out a little

export function createGait({ ground }) {
  const feet = [1, -1].map((side) => ({
    side, // +1 left, -1 right
    anchor: new THREE.Vector3(), // ground point under the ankle (foot flat)
    normal: new THREE.Vector3(0, 1, 0),
    yaw: 0,
    planted: true,
    swing: null, // { kind, from, fromY, fromYaw, to, toY, toYaw, dur, t, height, obstacle }
    pitch: 0, // degrees: + toes up (heel contact), - heel up (push off)
    stance: 0, // progress through stance 0..1 (gait), for the foot roll
    offset: side > 0 ? 0 : 0.5, // gait phase offset
    prevPsi: 0.99,
    td: null, // pitch at touchdown when it isn't a heel strike (toes first, stepping down)
  }));
  const st = { lastSpeed: 0, bodyPos: new THREE.Vector3(), phase: 0, cadence: 1, duty: 0.6, moving: false, air: false, initialized: false, time: 0 };
  const fwd = new THREE.Vector3(), left = new THREE.Vector3(), tmp = new THREE.Vector3(), pred = new THREE.Vector3();
  const rel = new THREE.Vector3(), rel2 = new THREE.Vector3();

  const axes = (yaw) => {
    fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    left.set(Math.cos(yaw), 0, -Math.sin(yaw));
  };
  function stanceSpot(foot, pos, yaw, out) {
    axes(yaw);
    return out.copy(pos).addScaledVector(left, foot.side * 0.12).addScaledVector(fwd, foot.side > 0 ? 0.05 : -0.03);
  }
  // plant a foot on the ground found below `top` (or at `top` - 0.2 if there's none)
  function plantAt(foot, x, top, z, yaw) {
    const g = ground(x, z, top);
    foot.anchor.set(x, g ? g.y : top - 0.2, z);
    if (g) foot.normal.copy(g.n);
    foot.yaw = yaw;
    foot.planted = true;
    foot.swing = null;
  }
  function beginSwing(foot, kind, dur, height, run = 0) {
    foot.planted = false;
    foot.swing = {
      kind, dur, t: 0, height, runBlend: run,
      from: foot.anchor.clone(), fromYaw: foot.yaw,
      to: foot.anchor.clone(), toYaw: foot.yaw, toNormal: foot.normal.clone(),
      lift: 0, // extra height needed to clear obstacles on the way
    };
  }
  // where a foot should land for a gait step, `r` seconds from now
  function gaitTarget(foot, b, r, stanceLen, out) {
    const yawTD = b.facing + b.turnRate * r;
    // where the body will be at touchdown, speeding up if he's accelerating
    const a = Math.max(0, b.accel ?? 0), sp = Math.hypot(b.vel.x, b.vel.z);
    pred.copy(b.pos).addScaledVector(b.vel, r);
    if (sp > 0.05 && a > 0) {
      pred.addScaledVector(b.vel, (0.5 * a * r * r) / sp);
      const vf = Math.min(sp + a * r, 9);
      stanceLen = Math.max(stanceLen, (vf * duty(vf)) / cadence(vf));
    }
    axes(yawTD);
    // the body passes over the foot about a third of the way through its stance
    out.copy(pred).addScaledVector(fwd, stanceLen * lerp(0.4, 0.3, runBlend(b.speed))).addScaledVector(left, foot.side * halfWidth(b.speed));
    return yawTD + foot.side * TOE_OUT * (1 - runBlend(b.speed));
  }
  function aimSwing(foot, x, z, yaw, baseY) {
    const s = foot.swing;
    const g = ground(x, z, baseY + 0.75);
    s.to.set(x, g ? g.y : baseY, z);
    if (g) s.toNormal.copy(g.n);
    s.toYaw = yaw;
    // clear whatever lies between (stair edges): the highest ground under the heel or
    // the toes along the way, above the straight line
    let lift = 0;
    const dx = x - s.from.x, dz = z - s.from.z, dl = Math.hypot(dx, dz) || 1;
    for (const f of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      for (const toe of [-0.06, 0.13]) {
        const gx = lerp(s.from.x, x, f) + (dx / dl) * toe, gz = lerp(s.from.z, z, f) + (dz / dl) * toe;
        const gg = ground(gx, gz, Math.max(s.from.y, s.to.y) + 0.5);
        if (gg) lift = Math.max(lift, gg.y + 0.05 - lerp(s.from.y, s.to.y, f));
      }
    }
    s.lift = lift;
    // stepping down: land toes first
    foot.td = s.to.y < s.from.y - 0.1 ? -12 : null;
  }

  return {
    feet,
    state: st,
    // b: { pos, vel, speed, facing, turnRate, grounded, air, wading, dt }
    update(b) {
      const dt = b.dt;
      st.time += dt;
      if (!st.initialized) {
        for (const f of feet) {
          stanceSpot(f, b.pos, b.facing, tmp);
          plantAt(f, tmp.x, b.pos.y + 0.5, tmp.z, b.facing + f.side * TOE_OUT);
        }
        st.initialized = true;
      }
      // teleports / respawns: re-plant under the body
      for (const f of feet) {
        if (f.planted && f.anchor.distanceTo(b.pos) > 2.5) {
          for (const g of feet) {
            stanceSpot(g, b.pos, b.facing, tmp);
            plantAt(g, tmp.x, b.pos.y + 0.5, tmp.z, b.facing + g.side * TOE_OUT);
          }
          break;
        }
      }

      // in the air the animator places the feet; mark and wait
      if (b.air) {
        st.air = true;
        st.moving = false;
        return;
      }
      if (st.air) {
        // landed: plant each foot below where it hangs (the animator passes b.airFeet)
        st.air = false;
        feet.forEach((f, i) => {
          const p = b.airFeet?.[i] ?? stanceSpot(f, b.pos, b.facing, tmp);
          plantAt(f, p.x, b.pos.y + 0.5, p.z, b.facing + f.side * TOE_OUT);
          f.pitch = 0;
        });
        const lead = feet[0].anchor.clone().sub(feet[1].anchor).dot(fwd.set(Math.sin(b.facing), 0, Math.cos(b.facing)));
        st.phase = lead > 0 ? 0.5 : 0; // the rear foot steps first
        for (const f of feet) f.prevPsi = (st.phase + f.offset) % 1;
      }

      st.bodyPos.copy(b.pos);
      const v = b.speed;
      st.lastSpeed = Math.max(v, st.lastSpeed - 3 * dt); // recent top speed (for braking steps)
      const wasMoving = st.moving;
      st.moving = v > (st.moving ? 0.3 : 0.45);
      // quicker steps while accelerating (short, fast steps away from a standstill)
      const f = cadence(v) * (1 - 0.25 * b.wading) * (1 + clamp((b.accel ?? 0) / 10, 0, 0.8));
      const D = duty(v);
      const stanceLen = (v * D) / Math.max(f, 0.1);
      const height = clearance(v) + 0.3 * b.wading; // high knees through water

      if (st.moving && !wasMoving) {
        // starting off: the foot behind (relative to where he's heading) steps first
        axes(Math.atan2(b.vel.x, b.vel.z));
        const rear = feet[0].anchor.dot(fwd) < feet[1].anchor.dot(fwd) ? 0 : 1;
        st.phase = (1 - feet[rear].offset + 0.001) % 1;
        for (const ft of feet) ft.prevPsi = 0.999;
      }
      if (!st.moving && wasMoving) {
        // stopping: a step under way carries on from where the foot is and comes down
        // under the body (a new swing, so the pose blends from here)
        for (const ft of feet) {
          if (ft.swing && ft.swing.kind === 'gait') {
            const s = ft.swing;
            const from = new THREE.Vector3();
            const fromYaw = swingPose(ft, from);
            // from a run, the step coming down is a braking step: planted ahead, heel first
            const brake = st.lastSpeed > 2.2;
            ft.swing = { ...s, kind: brake ? 'brake' : 'stop', from, fromYaw, t: 0, dur: clamp(s.dur - s.t, 0.16, 0.3), height: 0.03, lift: 0, bodyFrom: null };
            if (brake) {
              axes(b.facing);
              stanceSpot(ft, b.pos, b.facing, tmp).addScaledVector(fwd, 0.1 + 0.03 * st.lastSpeed);
              aimSwing(ft, tmp.x, tmp.z, b.facing + ft.side * TOE_OUT, b.pos.y);
              ft.td = 10;
            }
          }
        }
      }

      st.cadence = f;
      st.duty = D;
      if (st.moving) {
        // a planted foot left too far behind (speeding up, turning) makes the next steps
        // come sooner: the clock runs faster until it lifts, as people quicken their
        // steps when they accelerate
        axes(Math.atan2(b.vel.x, b.vel.z));
        const maxBehind = Math.max(0.25, stanceLen * (1 - lerp(0.4, 0.3, runBlend(v)))) + 0.08;
        let stretch = 0;
        for (const ft of feet) if (ft.planted) stretch = Math.max(stretch, tmp.subVectors(b.pos, ft.anchor).dot(fwd) - maxBehind);
        st.phase = (st.phase + f * (1 + clamp(stretch / 0.12, 0, 2.5)) * dt) % 1;
        for (const ft of feet) {
          const psi = (st.phase + ft.offset) % 1;
          const swingEnd = 1 - D;
          const wrapped = psi < ft.prevPsi - 0.5; // crossed 1 -> 0: lift-off
          if (ft.planted && (wrapped || (psi < swingEnd && ft.prevPsi >= 0.999))) {
            beginSwing(ft, 'gait', swingEnd / f, height, runBlend(v));
            ft.swing.bodyFrom = b.pos.clone();
            ft.swing.wade = b.wading;
            // the step's timing is fixed at lift-off: the stance share shrinks as he speeds
            // up, which would otherwise keep pushing the landing later
            ft.swing.endPsi = swingEnd;
          }
          if (ft.swing && ft.swing.kind !== 'gait') {
            // a settling step still under way when he sets off: finish it first
            ft.swing.t += dt;
            if (ft.swing.t >= ft.swing.dur) plantAt(ft, ft.swing.to.x, ft.swing.to.y + 0.2, ft.swing.to.z, ft.swing.toYaw);
          } else if (ft.swing) {
            const s = ft.swing;
            const endPsi = Math.min(s.endPsi, 0.995);
            s.t = Math.min(1, psi / endPsi) * s.dur;
            s.height = height;
            s.runBlend = runBlend(v);
            const r = Math.max(0, (endPsi - psi) / f);
            const yaw = gaitTarget(ft, b, r, stanceLen, tmp);
            (s.predBody ??= new THREE.Vector3()).copy(pred);
            aimSwing(ft, tmp.x, tmp.z, yaw, b.pos.y);
            if (psi >= endPsi) {
              plantAt(ft, s.to.x, s.to.y + 0.2, s.to.z, s.toYaw);
            }
          }
          ft.stance = ft.planted ? clamp((psi - swingEnd) / D, 0, 1) : 0;
          ft.prevPsi = psi;
        }
      } else {
        // standing: settle / turn-in-place steps, one foot at a time
        for (const ft of feet) {
          if (!ft.swing) continue;
          const s = ft.swing;
          s.t += dt;
          if (s.kind === 'stop' || s.kind === 'idle') {
            // keep aiming at the neutral spot (the body may still be drifting)
            stanceSpot(ft, b.pos, b.facing, tmp);
            aimSwing(ft, tmp.x, tmp.z, b.facing + ft.side * TOE_OUT, b.pos.y);
          }
          if (s.t >= s.dur) plantAt(ft, s.to.x, s.to.y + 0.2, s.to.z, s.toYaw);
        }
        if (!feet.some((ft) => ft.swing)) {
          let worst = null, worstErr = 0;
          for (const ft of feet) {
            stanceSpot(ft, b.pos, b.facing, tmp);
            const d = Math.hypot(ft.anchor.x - tmp.x, ft.anchor.z - tmp.z);
            let dy = b.facing + ft.side * TOE_OUT - ft.yaw;
            dy = Math.abs(Math.atan2(Math.sin(dy), Math.cos(dy)));
            const err = d / 0.2 + dy / 0.55;
            if (err > 1 && err > worstErr) {
              worst = ft;
              worstErr = err;
            }
          }
          if (worst) beginSwing(worst, 'idle', 0.3, 0.07 + 0.15 * b.wading);
        }
        for (const ft of feet) ft.stance = ft.planted ? 0.5 : 0;
      }

      // foot pitch (degrees): heel contact, flat, heel lift and toe-off; toes up before contact
      const r = runBlend(v);
      // the foot leaves the ground steeply (~55-60 degrees at toe-off)
      const heelStrike = lerp(9, 4, r); // a soft, rolling heel contact
      const pushOff = -lerp(50, 60, r) * (1 - 0.6 * b.wading);
      for (const ft of feet) {
        let target = 0;
        if (ft.planted) {
          if (st.moving) {
            const s = ft.stance;
            const rise = lerp(0.45, 0.3, r);
            const k = (s - rise) / (1 - rise);
            target = s < 0.15 ? lerp(ft.td ?? heelStrike, 0, s / 0.15) : s > rise ? pushOff * k * k : 0;
          }
        } else if (ft.swing) {
          const s = clamp(ft.swing.t / ft.swing.dur, 0, 1);
          const td = ft.td ?? heelStrike;
          target = ft.swing.kind === 'gait' ? (s < 0.35 ? lerp(pushOff, -8, s / 0.35) : s < 0.7 ? lerp(-8, 2, (s - 0.35) / 0.35) : lerp(2, td, (s - 0.7) / 0.3)) : 6 * Math.sin(Math.PI * s);
        }
        ft.pitch = target;
      }
    },
    swingPose,
  };

  // current position of a swinging foot's ground point (and yaw), for the animator
  function swingPose(foot, out) {
    const s = foot.swing;
    const u = clamp(s.t / s.dur, 0, 1);
    // walking: eased across the ground from footprint to footprint. Running: the path
    // is relative to the body, as a runner's legs cycle under it: the heel comes up
    // under the hips first, then the foot swings through and reaches forward, pawing
    // back a little before it lands
    const e = 0.5 - 0.5 * Math.cos(Math.PI * u);
    out.lerpVectors(s.from, s.to, e);
    const run = s.kind === 'gait' && s.bodyFrom && s.predBody ? s.runBlend : 0;
    if (run > 0) {
      const g = u * u * (3 - 2 * u) + 0.1 * Math.sin(Math.PI * u) * u;
      rel.subVectors(s.from, s.bodyFrom).lerp(rel2.subVectors(s.to, s.predBody), g).add(st.bodyPos);
      out.x = lerp(out.x, rel.x, run);
      out.z = lerp(out.z, rel.z, run);
    }
    // highest early (the heel comes up behind right after toe-off), then forward and
    // down to land
    // (wading: the knee lifts the foot up and forward out of the water, highest mid-step)
    const peak = s.kind === 'gait' ? lerp(lerp(0.3, 0.2, s.runBlend), 0.5, s.wade ?? 0) : 0.45;
    const arc = Math.sin(Math.PI * Math.pow(u, Math.log(0.5) / Math.log(peak)));
    out.y = lerp(s.from.y, s.to.y, e) + arc * (s.height + s.lift);
    let dy = s.toYaw - s.fromYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return s.fromYaw + dy * e;
  }
}
