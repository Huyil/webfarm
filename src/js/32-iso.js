/* ============ 等距投影 ============ */
function iso(gx, gy){ return { sx: (gx-gy)*HALF_W, sy: (gx+gy)*HALF_H }; }
function unIso(sx, sy){
  const a = sx/HALF_W, b = sy/HALF_H;
  return { wx: (a+b)/2, wy: (b-a)/2 };
}

