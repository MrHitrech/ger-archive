/** Offline orthographic render. The site only downloads the resulting WebP. */
export async function renderGameModel({
  scene,
  textures,
  category = '',
  width = 768,
  height = 512,
  view = null,
}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.replaceChildren(canvas);
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL unavailable for native model export');
  function shader(type, code) {
    const s = gl.createShader(type);
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      `
    attribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec4 color;
    varying vec3 n; varying vec2 t; varying vec4 c;
    void main(){gl_Position=vec4(position,1.0);n=normal;t=uv;c=color;}`,
    ),
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      `
    precision highp float; varying vec3 n; varying vec2 t; varying vec4 c; uniform sampler2D diffuse;
    void main(){vec4 tex=texture2D(diffuse,t);vec3 nn=normalize(n);
      float key=max(dot(nn,normalize(vec3(-0.4,0.7,0.8))),0.0);
      float fill=max(dot(nn,normalize(vec3(0.8,-0.1,0.4))),0.0);
      vec3 rgb=tex.rgb*c.rgb*(0.74+0.38*key+0.13*fill);
      gl_FragColor=vec4(rgb,1.0);}`,
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    unit = (a) => {
      const l = Math.hypot(...a);
      return a.map((v) => v / l);
    },
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const aragami = category === 'aragami',
    shield = ['buckler', 'shield', 'tower_shield'].includes(category),
    gun = ['sniper', 'assault', 'blast', 'shotgun'].includes(category);
  const direction = unit(
      view?.direction ?? (aragami ? [1, 0.35, 1.2] : shield ? [0.26, -0.45, 1] : [1, -1, 0.45]),
    ),
    upHint = view?.up ?? (aragami || shield ? [0, 1, 0] : [0, 0, 1]);
  let right = unit(cross(upHint, direction)),
    up = unit(cross(direction, right));
  const roll = view?.roll ?? (aragami || shield ? 0 : gun ? -1.05 : -0.4),
    co = Math.cos(roll),
    si = Math.sin(roll),
    oldRight = right;
  right = right.map((v, i) => v * co + up[i] * si);
  up = up.map((v, i) => v * co - oldRight[i] * si);
  // Trigger meshes are the replacements shown after a bond breaks.
  const meshes = scene.meshes.filter((m) => !aragami || !/^Trigger_|^Change_/.test(m.name));
  if (!meshes.length) throw new Error('No visible meshes to render');
  const projected = meshes.map((m) => {
    const positions = [],
      normals = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      const p = m.positions.slice(i, i + 3),
        n = m.normals.slice(i, i + 3);
      positions.push(dot(p, right), dot(p, up), dot(p, direction));
      normals.push(dot(n, right), dot(n, up), dot(n, direction));
    }
    return { ...m, positions, normals };
  });
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const m of projected)
    for (const i of new Set(m.indices))
      for (let c = 0; c < 3; c++) {
        const v = m.positions[i * 3 + c];
        min[c] = Math.min(min[c], v);
        max[c] = Math.max(max[c], v);
      }
  const center = min.map((v, i) => (v + max[i]) / 2),
    aspect = width / height,
    scale = 1.72 / Math.max((max[0] - min[0]) / aspect, max[1] - min[1]),
    depth = Math.max(...max.map((v, i) => v - min[i]));
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  const textureMap = new Map();
  for (const [name, url] of Object.entries(textures)) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, view?.flipY ?? false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    textureMap.set(name.toLowerCase().replace(/\.(tga|png|bmp)$/, ''), texture);
  }
  function attribute(name, values, components) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, components, gl.FLOAT, false, 0, 0);
    return b;
  }
  for (const m of projected) {
    const material = scene.materials.find((t) => t.id === m.material),
      name = material.textures[0].toLowerCase().replace(/\.(tga|png|bmp)$/, ''),
      texture = textureMap.get(name);
    if (!texture) throw new Error('Missing diffuse texture ' + name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, 'diffuse'), 0);
    const positions = m.positions.map((v, i) =>
      i % 3 === 0
        ? ((v - center[0]) * scale) / aspect
        : i % 3 === 1
          ? (v - center[1]) * scale
          : (-(v - center[2]) / depth) * 1.5,
    );
    const buffers = [
      attribute('position', positions, 3),
      attribute('normal', m.normals, 3),
      attribute('uv', m.uvs, 2),
      attribute('color', m.colors, 4),
    ];
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.indices), gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, m.indices.length, gl.UNSIGNED_SHORT, 0);
    for (const b of [...buffers, index]) gl.deleteBuffer(b);
  }
  gl.finish();
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error('WebGL error ' + error);
  return {
    png: canvas.toDataURL('image/png'),
    triangles: meshes.reduce((s, m) => s + m.indices.length / 3, 0),
    meshes: meshes.map((m) => m.name),
    view: { direction, up: upHint, roll, flipY: view?.flipY ?? false },
    bounds: { min, max },
  };
}
