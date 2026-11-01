// 跟服务端说话的唯一入口
async function request(path, { method = 'GET', body, raw } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw Object.assign(new Error('连不上服务，看看 node 还在不在跑'), { status: 0 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return raw ? res : data;
}

function imageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ w: 0, h: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export const api = {
  session: () => request('/api/session'),
  login: (username, password) => request('/api/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  bootstrap: () => request('/api/bootstrap'),
  saveSettings: (patch) => request('/api/settings', { method: 'PUT', body: patch }),

  notes: {
    list: () => request('/api/notes'),
    add: (text) => request('/api/notes', { method: 'POST', body: { text } }),
    remove: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),
  },
  moments: {
    list: () => request('/api/moments'),
    add: (payload) => request('/api/moments', { method: 'POST', body: payload }),
    remove: (id) => request(`/api/moments/${id}`, { method: 'DELETE' }),
  },
  photos: {
    list: () => request('/api/photos'),
    add: (payload) => request('/api/photos', { method: 'POST', body: payload }),
    update: (id, patch) => request(`/api/photos/${id}`, { method: 'PUT', body: patch }),
    remove: (id) => request(`/api/photos/${id}`, { method: 'DELETE' }),
  },
  events: {
    list: () => request('/api/events'),
    add: (payload) => request('/api/events', { method: 'POST', body: payload }),
    remove: (id) => request(`/api/events/${id}`, { method: 'DELETE' }),
  },
  tracks: {
    list: () => request('/api/tracks'),
    add: (payload) => request('/api/tracks', { method: 'POST', body: payload }),
    remove: (id) => request(`/api/tracks/${id}`, { method: 'DELETE' }),
  },

  /**
   * 照片上传：先跟服务端要一条预签名 PUT 链接，再直传 R2（或本机存储），
   * 浏览器全程拿不到任何密钥。
   */
  async uploadPhoto(file, caption = '') {
    const presign = await request('/api/uploads/presign', {
      method: 'POST',
      body: { contentType: file.type || 'image/jpeg' },
    });
    const put = await fetch(presign.uploadUrl, {
      method: presign.method || 'PUT',
      headers: presign.headers,
      body: file,
      credentials: presign.mode === 'local' ? 'same-origin' : 'omit',
    });
    if (!put.ok) {
      throw new Error(presign.mode === 'r2' ? '上传到 R2 失败（检查桶的 CORS 设置）' : '上传失败');
    }
    const size = await imageSize(file);
    const out = await request('/api/photos', {
      method: 'POST',
      body: {
        key: presign.key,
        w: size.w,
        h: size.h,
        size: file.size,
        type: file.type,
        caption,
      },
    });
    return out.photo;
  },
  // 购物车：想一起做的事
  cart: {
    list: () => request('/api/cart'),
    add: (payload) => request('/api/cart', { method: 'POST', body: payload }),
    update: (id, patch) => request('/api/cart/' + id, { method: 'PUT', body: patch }),
    remove: (id) => request('/api/cart/' + id, { method: 'DELETE' }),
  },

  // 培养系统
  pet: {
    get: () => request('/api/pet'),
    consent: () => request('/api/pet/consent', { method: 'POST', body: {} }),
    care: (kind) => request('/api/pet/care', { method: 'POST', body: { kind } }),
    talk: (text) => request('/api/pet/talk', { method: 'POST', body: { text } }),
    seen: () => request('/api/pet/talk/seen', { method: 'POST', body: {} }),
    open: () => request('/api/pet/open', { method: 'POST', body: {} }),
    wish: (text, foodId) => request('/api/pet/wish', { method: 'POST', body: { text, foodId } }),
  },
};