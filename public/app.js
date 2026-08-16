// public/app.js — vanilla JS, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
};

// ---- Session (stored client-side; sent as x-user-id header) -------------

const Session = {
  get() {
    const raw = localStorage.getItem('commons.user');
    return raw ? JSON.parse(raw) : null;
  },
  set(user) {
    localStorage.setItem('commons.user', JSON.stringify(user));
    renderIdentity();
  },
  clear() {
    localStorage.removeItem('commons.user');
    renderIdentity();
  },
};

async function api(path, options = {}) {
  const user = Session.get();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (user) headers['x-user-id'] = user.id;
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && user) {
      Session.clear();
      location.hash = '#/login';
      router();
    }
    throw new Error(body.error || 'Something went wrong');
  }
  return body;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ---- Identity UI ----------------------------------------------------------

function renderIdentity() {
  const user = Session.get();
  const btn = $('#identity-btn');
  const navNew = $('#nav-new');
  if (user) {
    btn.textContent = `${user.name} · ${user.role === 'admin' ? 'Admin' : 'Attendee'}`;
    navNew.classList.toggle('hidden', user.role !== 'admin');
  } else {
    btn.textContent = 'Sign in';
    navNew.classList.add('hidden');
  }
}

$('#identity-btn').addEventListener('click', () => {
  location.hash = Session.get() ? '#/profile' : '#/login';
});

// ---- Router ----------------------------------------------------------

const app = $('#app');

function currentRoute() {
  return location.hash.replace(/^#/, '') || '/events';
}

window.addEventListener('hashchange', router);

function setActiveNav(route) {
  $$nav().forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${route}`));
}
function $$nav() { return Array.from(document.querySelectorAll('.topbar__nav a')); }

async function router() {
  const route = currentRoute();
  setActiveNav(route.startsWith('/new') ? '/new' : route === '/profile' ? '/profile' : '/events');
  try {
    if (route === '/events' || route === '/') {
      await renderEventsList();
    } else if (route === '/new') {
      renderCreateEvent();
    } else if (route === '/profile') {
      await renderUserProfile();
    } else if (route === '/login') {
      renderLogin();
    } else if (route === '/register') {
      renderRegister();
    } else if (route.startsWith('/events/')) {
      const id = route.split('/events/')[1];
      await renderEventDetail(id);
    } else {
      app.innerHTML = '';
      app.appendChild(el('div', { class: 'empty-state' }, ['Page not found.']));
    }
  } catch (err) {
    app.innerHTML = '';
    app.appendChild(el('div', { class: 'empty-state' }, [err.message]));
  }
}

// ---- Events list ----------------------------------------------------------

function fmtDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return {
    month: d.toLocaleDateString(undefined, { month: 'short' }),
    day: d.toLocaleDateString(undefined, { day: 'numeric' }),
  };
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

async function renderEventsList() {
  app.innerHTML = '';

  const { events } = await api('/api/events');
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => e.date >= today && e.status !== 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt);
  const past = events
    .filter((e) => e.date < today || e.status === 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt);

  const tabsEl = el('div', { class: 'tabs' });
  const bodyEl = el('div');
  let active = 'upcoming';

  function renderBody() {
    bodyEl.innerHTML = '';
    const list = active === 'upcoming' ? upcoming : past;
    if (list.length === 0) {
      bodyEl.appendChild(
        el('div', { class: 'empty-state' }, [
          active === 'upcoming'
            ? (Session.get()?.role === 'admin' ? 'No upcoming games. Create the first one!' : 'No upcoming games. Check back soon.')
            : 'No past games yet.',
        ])
      );
      return;
    }
    const ticketList = el('div', { class: 'event-grid' });
    list.forEach((ev) => ticketList.appendChild(ticketCard(ev)));
    bodyEl.appendChild(ticketList);
  }

  [
    { key: 'upcoming', label: 'Upcoming games' },
    { key: 'past', label: 'Past games' },
  ].forEach(({ key, label }) => {
    const btn = el('button', {
      class: `tab ${key === active ? 'active' : ''}`,
      onclick: () => {
        active = key;
        tabsEl.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderBody();
      },
    }, [label]);
    tabsEl.appendChild(btn);
  });

  app.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, ['Games'])]));
  app.appendChild(tabsEl);
  app.appendChild(bodyEl);
  renderBody();
}

function ticketCard(ev) {
  const { month, day } = fmtDate(ev.date);
  const full = ev.counts.spotsLeft === 0;

  const imageEl = ev.image
    ? el('img', { class: 'event-card__image', src: ev.image, alt: ev.title })
    : el('div', { class: 'event-card__image event-card__image--placeholder' }, ['⚽']);

  return el('a', { class: 'event-card', href: `#/events/${ev.id}` }, [
    imageEl,
    el('div', { class: 'event-card__body' }, [
      el('h3', { class: 'event-card__title' }, [ev.title]),
      el('div', { class: 'event-card__meta' }, [
        el('span', {}, [`📅 ${month} ${day} · ${fmtTime(ev.time)}`]),
        el('span', {}, [`📍 ${ev.placeName}`]),
      ]),
      el('div', { class: 'event-card__footer' }, [
        ev.status === 'cancelled'
          ? el('span', { class: 'badge badge--cancelled' }, ['Cancelled'])
          : full
            ? el('span', { class: 'badge badge--full' }, [`Waitlist · ${ev.counts.waitlisted}`])
            : el('span', { class: 'badge badge--open' }, [`${ev.counts.spotsLeft} spots left`]),
      ]),
    ]),
  ]);
}

// ---- Create event ----------------------------------------------------------

function renderCreateEvent() {
  const user = Session.get();
  if (!user || user.role !== 'admin') {
    app.innerHTML = '';
    app.appendChild(
      el('div', { class: 'empty-state' }, ['Sign in as an admin to create a game.'])
    );
    return;
  }

  app.innerHTML = '';
  const picked = { lat: null, lng: null, name: null };
  let imageData = null;

  const PRESETS = [
    { short: 'Veterans Field', query: 'Veterans Park, Edgewater, Bergen County, New Jersey, United States' },
    { short: 'Constitution Park', query: 'Constitution Park, Fort Lee' },
  ];

  const presetsDiv = el('div', { class: 'place-presets' });
  PRESETS.forEach((p) => {
    presetsDiv.appendChild(el('button', {
      type: 'button',
      class: 'btn btn--ghost place-preset-btn',
      onclick: async () => {
        const results = await geocode(p.query);
        if (!results.length) { toast('Could not locate this place.'); return; }
        const r = results[0];
        picked.lat = parseFloat(r.lat);
        picked.lng = parseFloat(r.lon);
        picked.name = r.display_name;
        $('#f-place').value = r.display_name;
        $('#f-place-picked').style.display = 'block';
        $('#f-place-picked').textContent = `📍 Pinned: ${r.display_name}`;
        $('#f-place-results').classList.add('hidden');
        showPickedOnMap(picked.lat, picked.lng);
      },
    }, [p.short]));
  });

  const selectedHosts = [];
  let allMembers = null;

  const hostChipsEl = el('div', { class: 'host-chips' });
  const hostDropdown = el('ul', { class: 'place-results hidden', id: 'f-hosts-dropdown' });

  function refreshHostChips() {
    hostChipsEl.innerHTML = '';
    selectedHosts.forEach(h => {
      hostChipsEl.appendChild(el('span', { class: 'host-chip' }, [
        h.name,
        el('button', { type: 'button', class: 'host-chip-remove', onclick: () => {
          const i = selectedHosts.findIndex(x => x.id === h.id);
          if (i !== -1) selectedHosts.splice(i, 1);
          refreshHostChips();
        }}, ['×']),
      ]));
    });
  }

  const addHostBtn = el('button', { type: 'button', class: 'btn btn--ghost add-host-btn' }, ['+ Add host']);

  addHostBtn.addEventListener('click', async () => {
    if (!allMembers) {
      try { const { users } = await api('/api/users'); allMembers = users; }
      catch { toast('Could not load members'); return; }
    }
    hostDropdown.innerHTML = '';
    const remaining = allMembers.filter(m => !selectedHosts.find(h => h.id === m.id));
    if (!remaining.length) {
      hostDropdown.appendChild(el('li', {}, ['All members added']));
    } else {
      remaining.forEach(m => {
        hostDropdown.appendChild(el('li', { onclick: () => {
          selectedHosts.push({ id: m.id, name: m.name });
          hostDropdown.classList.add('hidden');
          refreshHostChips();
        }}, [m.name]));
      });
    }
    hostDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!document.body.contains(hostDropdown)) return;
    if (!hostDropdown.classList.contains('hidden') && !hostDropdown.contains(e.target) && e.target !== addHostBtn) {
      hostDropdown.classList.add('hidden');
    }
  });

  const hostsSection = el('div', { class: 'hosts-field' }, [
    el('span', { class: 'hosts-field-label' }, ['Add hosts']),
    hostChipsEl,
    addHostBtn,
    hostDropdown,
  ]);

  const form = el('form', { id: 'create-form' }, [
    el('label', {}, ['Title', el('input', { type: 'text', id: 'f-title', required: 'true', placeholder: 'Sunday morning trail run' })]),
    el('div', { class: 'field-row' }, [
      el('label', {}, ['Date', el('input', { type: 'date', id: 'f-date', required: 'true' })]),
      el('label', {}, ['Time', el('input', { type: 'time', id: 'f-time', required: 'true', value: '18:00' })]),
    ]),
    el('label', {}, [
      'Attendees',
      el('input', { type: 'number', id: 'f-capacity', min: '1', value: '20', required: 'true' }),
    ]),
    hostsSection,
    el('label', {}, [
      'Place',
      presetsDiv,
      el('div', { class: 'place-search' }, [
        el('input', { type: 'text', id: 'f-place', placeholder: 'Or search an address or venue…' }),
        el('button', { type: 'button', class: 'btn btn--ghost', id: 'f-place-search' }, ['Search']),
      ]),
    ]),
    el('ul', { class: 'place-results hidden', id: 'f-place-results' }),
    el('div', { class: 'place-picked', id: 'f-place-picked' }),
    el('div', { id: 'new-map' }),
    el('label', { style: 'margin-top: 16px;' }, [
      'Optional question',
      el('input', { type: 'text', id: 'f-question', placeholder: 'e.g. What position do you play?' }),
    ]),
    el('div', { class: 'btn-row', style: 'margin-top: 20px;' }, [
      el('button', { type: 'submit', class: 'btn btn--primary' }, ['Create game']),
    ]),
  ]);

  // Image upload widget
  const imgPreviewEl = el('img', { class: 'game-img-preview' });
  imgPreviewEl.style.display = 'none';
  const imgPlaceholderEl = el('div', { class: 'game-img-placeholder' }, ['📷  Add a game photo']);
  const imgChangeEl = el('div', { class: 'game-img-upload__change' }, ['Change photo']);
  imgChangeEl.style.display = 'none';
  const imgFileInput = el('input', { type: 'file', accept: 'image/*' });
  imgFileInput.style.display = 'none';
  const imgUpload = el('div', { class: 'game-img-upload' }, [imgPreviewEl, imgPlaceholderEl, imgChangeEl, imgFileInput]);
  imgUpload.addEventListener('click', () => imgFileInput.click());
  imgFileInput.addEventListener('change', () => {
    const file = imgFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 800;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        imageData = canvas.toDataURL('image/jpeg', 0.72);
        imgPreviewEl.src = imageData;
        imgPreviewEl.style.display = 'block';
        imgPlaceholderEl.style.display = 'none';
        imgChangeEl.style.display = '';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  app.appendChild(
    el('div', { class: 'form-card' }, [
      imgUpload,
      el('h1', {}, ['Create a game']),
      el('p', {}, ['Give it a name, a time, and a place — attendees can sign up right away.']),
      form,
    ])
  );

  let map, marker;

  $('#f-place-search').addEventListener('click', async () => {
    const q = $('#f-place').value.trim();
    if (!q) return;
    const results = await geocode(q);
    const list = $('#f-place-results');
    list.innerHTML = '';
    if (results.length === 0) {
      list.classList.remove('hidden');
      list.appendChild(el('li', {}, ['No matches — try a different search.']));
      return;
    }
    results.forEach((r) => {
      list.appendChild(
        el('li', {
          onclick: () => {
            picked.lat = parseFloat(r.lat);
            picked.lng = parseFloat(r.lon);
            picked.name = r.display_name;
            $('#f-place').value = r.display_name;
            $('#f-place-picked').style.display = 'block';
            $('#f-place-picked').textContent = `📍 Pinned: ${r.display_name}`;
            list.classList.add('hidden');
            showPickedOnMap(picked.lat, picked.lng);
          },
        }, [r.display_name])
      );
    });
    list.classList.remove('hidden');
  });

  const OSM_STYLE = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };

  function showPickedOnMap(lat, lng) {
    const mapEl = $('#new-map');
    mapEl.style.display = 'block';
    if (!map) {
      map = new maplibregl.Map({ container: mapEl, style: OSM_STYLE, center: [lng, lat], zoom: 15 });
      marker = new maplibregl.Marker().setLngLat([lng, lat]).addTo(map);
    } else {
      map.setCenter([lng, lat]);
      marker.setLngLat([lng, lat]);
    }
    setTimeout(() => map.resize(), 50);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!picked.lat) {
      toast('Search for a place and pick a result first.');
      return;
    }
    try {
      const { event } = await api('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          title: $('#f-title').value.trim(),
          date: $('#f-date').value,
          time: $('#f-time').value,
          capacity: $('#f-capacity').value,
          placeName: picked.name,
          lat: picked.lat,
          lng: picked.lng,
          question: $('#f-question').value.trim() || null,
          image: imageData,
          hostUserIds: selectedHosts.map(h => h.id),
        }),
      });
      toast('Game created!');
      location.hash = `#/events/${event.id}`;
    } catch (err) {
      toast(err.message);
    }
  });
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// ---- Event detail ----------------------------------------------------------

let _detailMap = null; // kept outside so refresh() can destroy it before re-creating

async function renderEventDetail(id) {
  if (_detailMap) { try { _detailMap.remove(); } catch {} _detailMap = null; }
  app.innerHTML = '';
  const { event, signups } = await api(`/api/events/${id}`);
  const user = Session.get();

  const mySignup =
    user &&
    [...signups.attending, ...signups.waitlisted].find((s) => s.userId === user.id);

  const { month, day } = fmtDate(event.date);

  const head = el('div', { class: 'detail-head' }, [
    el('div', {}, [
      el('h1', {}, [event.title]),
      el('div', { class: 'meta-row' }, [
        el('span', {}, [`${month} ${day}, ${event.date.slice(0, 4)}`]),
        el('span', {}, [fmtTime(event.time)]),
        el('span', {}, [`📍 ${event.placeName}`]),
      ]),
    ]),
    el('div', { class: 'capacity' }, [
      `${event.counts.attending} / ${event.capacity} attending`,
      el('br'),
      event.counts.waitlisted > 0 ? `${event.counts.waitlisted} on waitlist` : '',
    ]),
  ]);

  const actionCard = el('div', { class: 'card' });
  renderActionCard(actionCard, event, mySignup, user);

  const mapCard = el('div', { class: 'card' }, [
    el('h3', {}, ['Where']),
    el('div', { id: 'map' }),
  ]);

  const rosterCard = el('div', { class: 'card' });
  renderRosterCard(rosterCard, signups);

  const weatherCard = el('div', { class: 'card' }, [
    el('h3', {}, ['Weather forecast']),
    el('p', { class: 'weather-loading' }, ['Loading…']),
  ]);

  const isHost = user && user.role === 'admin';
  const hostCard = isHost && event.status !== 'cancelled'
    ? el('div', { class: 'card' }, [
        el('h3', {}, ['Manage game']),
        el('button', {
          class: 'btn btn--danger',
          onclick: async () => {
            if (!confirm('Are you sure you want to cancel this game?')) return;
            try {
              await api(`/api/events/${event.id}/cancel-game`, { method: 'POST' });
              toast('Game cancelled');
              await refresh();
            } catch (err) { toast(err.message); }
          },
        }, ['Cancel game']),
      ])
    : null;

  const left = el('div', {}, [mapCard, weatherCard]);
  const right = el('div', {}, [...(hostCard ? [hostCard] : []), actionCard, rosterCard]);

  app.appendChild(head);
  app.appendChild(el('div', { class: 'detail-grid' }, [left, right]));

  if (event.lat && event.lng) {
    try {
      _detailMap = new maplibregl.Map({
        container: 'map',
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap contributors',
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: [event.lng, event.lat],
        zoom: 15,
      });
      new maplibregl.Marker()
        .setLngLat([event.lng, event.lat])
        .setPopup(new maplibregl.Popup().setText(event.placeName))
        .addTo(_detailMap);
      setTimeout(() => _detailMap && _detailMap.resize(), 50);
    } catch (err) {
      console.warn('Map init error:', err);
    }
  }

  async function refresh() {
    await renderEventDetail(id);
  }

  if (event.lat && event.lng) {
    const params = new URLSearchParams({ lat: event.lat, lng: event.lng, date: event.date, time: event.time });
    api(`/api/weather?${params}`).then(w => {
      weatherCard.innerHTML = '';
      weatherCard.appendChild(el('h3', {}, ['Weather forecast']));
      if (!w.available) {
        if (w.reason === 'not_configured') { weatherCard.remove(); return; }
        const msg = w.reason === 'too_far' ? 'Forecast is available within 5 days of the game.'
          : w.reason === 'past'            ? 'This game has already taken place.'
          :                                 'Weather forecast unavailable.';
        weatherCard.appendChild(el('p', { class: 'weather-note' }, [msg]));
      } else {
        const desc = w.description[0].toUpperCase() + w.description.slice(1);
        weatherCard.appendChild(
          el('div', { class: 'weather-data' }, [
            el('img', { class: 'weather-icon', src: `https://openweathermap.org/img/wn/${w.icon}@2x.png`, alt: desc }),
            el('div', { class: 'weather-main' }, [
              el('span', { class: 'weather-temp' }, [`${w.temp}°F`]),
              el('span', { class: 'weather-desc' }, [desc]),
            ]),
            el('div', { class: 'weather-details' }, [
              el('span', {}, [`Feels like ${w.feelsLike}°F`]),
              el('span', {}, [`💧 ${w.humidity}%`]),
              el('span', {}, [`💨 ${w.wind} mph`]),
            ]),
          ])
        );
      }
    }).catch(() => {
      weatherCard.innerHTML = '';
      weatherCard.appendChild(el('h3', {}, ['Weather forecast']));
      weatherCard.appendChild(el('p', { class: 'weather-note' }, ['Weather unavailable.']));
    });
  }

  function renderActionCard(container, event, mySignup, user) {
    const isPast = event.date < new Date().toISOString().slice(0, 10);

    container.innerHTML = '';
    container.appendChild(el('h3', {}, ['Your spot']));

    if (event.status === 'cancelled') {
      container.appendChild(el('p', { style: 'color:var(--rust);font-size:14px;' }, ['This game has been cancelled.']));
      return;
    }
    if (isPast) {
      container.appendChild(el('p', { style: 'color:var(--ink-soft);font-size:14px;' }, ['This game has already taken place.']));
      return;
    }
    if (!user) {
      container.appendChild(el('p', {}, ['Sign in to join this game.']));
      container.appendChild(el('button', { class: 'btn btn--primary', onclick: () => { location.hash = '#/login'; } }, ['Sign in']));
      return;
    }
    if (mySignup) {
      const label = mySignup.status === 'attending' ? "You're attending" : "You're on the waitlist";
      const badgeClass = mySignup.status === 'attending' ? 'badge--open' : 'badge--full';
      container.appendChild(el('span', { class: `badge ${badgeClass}` }, [label]));
      container.appendChild(el('p', { style: 'font-size:13px;color:var(--ink-soft);margin-top:8px;' }, [
        `${event.counts.attending} / ${event.capacity} attending · ${event.counts.spotsLeft} spots left`,
      ]));
      container.appendChild(
        el('div', { class: 'btn-row', style: 'margin-top: 14px;' }, [
          el('button', {
            class: 'btn btn--danger',
            onclick: async () => {
              try {
                await api(`/api/events/${event.id}/cancel`, { method: 'POST' });
                toast('Cancelled your spot');
                refresh().catch((err) => toast(err.message));
              } catch (err) { toast(err.message); }
            },
          }, ['Cancel my spot']),
        ])
      );
    } else {
      const full = event.counts.spotsLeft === 0;
      container.appendChild(
        el('p', {}, [full ? 'This game is full — you can join the waitlist.' : `${event.counts.spotsLeft} spots left.`])
      );

      const guestsInput = el('input', { type: 'number', min: '0', value: '0' });
      let answerInput = null;

      container.appendChild(el('label', { style: 'margin-top: 4px;' }, ['Guests bringing', guestsInput]));
      if (event.question) {
        answerInput = el('input', { type: 'text', placeholder: 'Your answer' });
        container.appendChild(el('label', {}, [event.question, answerInput]));
      }

      container.appendChild(
        el('div', { class: 'btn-row', style: 'margin-top: 12px;' }, [
          el('button', {
            class: 'btn btn--primary',
            onclick: async () => {
              try {
                await api(`/api/events/${event.id}/signup`, {
                  method: 'POST',
                  body: JSON.stringify({
                    guests: parseInt(guestsInput.value) || 0,
                    questionAnswer: answerInput ? answerInput.value.trim() || null : null,
                  }),
                });
                toast(full ? 'Added to the waitlist' : "You're in!");
                refresh().catch((err) => toast(err.message));
              } catch (err) { toast(err.message); }
            },
          }, [full ? 'Join waitlist' : 'Sign up']),
        ])
      );
    }
  }

  function renderRosterCard(container, signups) {
    container.innerHTML = '';
    const tabs = el('div', { class: 'tabs' });
    const body = el('div');
    const tabsDef = [
      { key: 'attending', label: `Attending (${signups.attending.length})` },
      { key: 'waitlisted', label: `Waitlist (${signups.waitlisted.length})` },
      { key: 'cancelled', label: `Cancelled (${signups.cancelled.length})` },
    ];
    let active = 'attending';

    function renderBody() {
      body.innerHTML = '';
      const rows = signups[active];
      if (rows.length === 0) {
        body.appendChild(el('div', { class: 'roster-empty' }, ['Nobody here yet.']));
        return;
      }
      const list = el('ul', { class: 'roster' });
      rows.forEach((s, i) => {
        const avatar = s.userPicture
          ? el('img', { class: 'roster-avatar', src: s.userPicture, alt: s.userName })
          : el('div', { class: 'roster-avatar roster-avatar--placeholder' }, [(s.userName || '?')[0].toUpperCase()]);
        const nameEl = el('span', { class: 'roster-name' }, [avatar, s.userName]);
        if (s.isGameHost) nameEl.appendChild(el('span', { class: 'badge badge--game-host' }, ['host']));
        list.appendChild(
          el('li', {}, [
            nameEl,
            el('span', { class: 'n' }, [active === 'attending' || active === 'waitlisted' ? `#${i + 1}` : '']),
          ])
        );
      });
      body.appendChild(list);
    }

    tabsDef.forEach((t) => {
      const btn = el('button', {
        class: `tab ${t.key === active ? 'active' : ''}`,
        onclick: () => {
          active = t.key;
          tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          renderBody();
        },
      }, [t.label]);
      tabs.appendChild(btn);
    });

    container.appendChild(el('h3', {}, ['Who’s on the list']));
    container.appendChild(tabs);
    container.appendChild(body);
    renderBody();
  }
}

// ---- User profile ----------------------------------------------------------

async function renderUserProfile() {
  const user = Session.get();
  if (!user) {
    app.innerHTML = '';
    app.appendChild(el('div', { class: 'empty-state' }, ['Sign in to view your profile.']));
    return;
  }

  app.innerHTML = '';
  const { profile, signups } = await api('/api/profile');

  let pictureData = profile.picture || null;

  const avatarImg = el('img', { class: 'profile-avatar__img', src: pictureData || '', alt: '' });
  if (!pictureData) avatarImg.style.display = 'none';

  const avatarPlaceholder = el('div', { class: 'profile-avatar__placeholder' }, ['📷']);
  if (pictureData) avatarPlaceholder.style.display = 'none';

  const fileInput = el('input', { type: 'file', accept: 'image/*' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(MAX / img.width, MAX / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        pictureData = canvas.toDataURL('image/jpeg', 0.82);
        avatarImg.src = pictureData;
        avatarImg.style.display = '';
        avatarPlaceholder.style.display = 'none';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  const avatarWrap = el('div', { class: 'profile-avatar' }, [
    avatarImg,
    avatarPlaceholder,
    el('div', { class: 'profile-avatar__overlay' }, ['Change photo']),
    fileInput,
  ]);
  avatarWrap.addEventListener('click', () => fileInput.click());

  const firstInput = el('input', { type: 'text', value: profile.firstName || '', placeholder: 'First name' });
  const lastInput = el('input', { type: 'text', value: profile.lastName || '', placeholder: 'Last name' });

  const profileCard = el('div', { class: 'profile-card' }, [
    avatarWrap,
    el('div', { class: 'profile-fields' }, [
      el('label', {}, ['First name', firstInput]),
      el('label', {}, ['Last name', lastInput]),
      el('div', { class: 'btn-row', style: 'margin-top: 4px;' }, [
        el('button', {
          class: 'btn btn--primary',
          onclick: async () => {
            if (!firstInput.value.trim()) {
              toast('First name is required.');
              firstInput.focus();
              return;
            }
            try {
              const { user: updated } = await api('/api/profile', {
                method: 'PATCH',
                body: JSON.stringify({
                  firstName: firstInput.value.trim(),
                  lastName: lastInput.value.trim() || null,
                  picture: pictureData,
                }),
              });
              Session.set(updated);
              toast('Profile saved!');
            } catch (err) { toast(err.message); }
          },
        }, ['Save']),
        el('button', {
          class: 'btn btn--ghost',
          onclick: () => {
            Session.clear();
            location.hash = '#/events';
          },
        }, ['Sign out']),
      ]),
    ]),
  ]);

  // Game history
  const historyCard = el('div', { class: 'card', style: 'margin-top: 24px;' });
  historyCard.appendChild(el('h3', {}, ['Game history']));

  if (signups.length === 0) {
    historyCard.appendChild(el('div', { class: 'roster-empty' }, ["You haven't joined any games yet."]));
  } else {
    const list = el('ul', { class: 'roster' });
    signups.forEach((s) => {
      if (!s.event) return;
      const { month, day } = fmtDate(s.event.date);
      const badgeClass = s.status === 'attending' ? 'badge--open' : s.status === 'waitlisted' ? 'badge--full' : '';
      list.appendChild(
        el('li', {}, [
          el('a', { href: `#/events/${s.event.id}`, class: 'history-link' }, [
            `${s.event.title}`,
            el('span', { class: 'history-date' }, [` · ${month} ${day}`]),
          ]),
          badgeClass ? el('span', { class: `badge ${badgeClass}` }, [s.status]) : el('span', { style: 'font-size:12px;color:var(--ink-soft)' }, ['cancelled']),
        ])
      );
    });
    historyCard.appendChild(list);
  }

  app.appendChild(el('div', { class: 'page-head' }, [el('h1', {}, ['Your profile'])]));
  app.appendChild(profileCard);
  app.appendChild(historyCard);

  if (user.role === 'admin') {
    const { users } = await api('/api/users');

    const membersCard = el('div', { class: 'card', style: 'margin-top: 24px;' });
    membersCard.appendChild(el('h3', {}, ['Members']));

    function renderMemberList(list) {
      const existing = membersCard.querySelector('.member-list');
      if (existing) existing.remove();
      const ul = el('ul', { class: 'roster member-list' });
      list.forEach((u) => {
        const isYou = u.id === user.id;
        const isAdmin = u.role === 'admin';
        ul.appendChild(
          el('li', {}, [
            el('span', {}, [u.name, isYou ? el('span', { style: 'color:var(--ink-soft);font-size:12px;margin-left:6px;' }, ['(you)']) : '']),
            el('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
              el('span', { class: `badge ${isAdmin ? 'badge--admin' : 'badge--open'}` }, [isAdmin ? 'Admin' : 'Attendee']),
              ...(!isYou ? [el('button', {
                class: 'btn btn--ghost',
                style: 'padding:4px 10px;font-size:12px;',
                onclick: async () => {
                  try {
                    const newRole = isAdmin ? 'user' : 'admin';
                    await api(`/api/users/${u.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
                    u.role = newRole;
                    renderMemberList(list);
                  } catch (err) { toast(err.message); }
                },
              }, [isAdmin ? 'Make attendee' : 'Make admin'])] : []),
            ]),
          ])
        );
      });
      membersCard.appendChild(ul);
    }

    renderMemberList(users);
    app.appendChild(membersCard);
  }
}

// ---- Login / Register ------------------------------------------------------

function renderLogin() {
  if (Session.get()) { location.hash = '#/events'; return; }
  app.innerHTML = '';

  const emailInput = el('input', { type: 'email', placeholder: 'your@email.com' });
  const passwordInput = el('input', { type: 'password', placeholder: '••••••••' });

  const form = el('form', {}, [
    el('label', {}, ['Email', emailInput]),
    el('label', {}, ['Password', passwordInput]),
    el('button', { type: 'submit', class: 'btn btn--primary', style: 'width:100%;margin-top:8px;' }, ['Log in']),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value }),
      });
      Session.set(user);
      location.hash = '#/events';
      router();
    } catch (err) { toast(err.message); }
  });

  app.appendChild(
    el('div', { class: 'auth-wrap' }, [
      el('div', { class: 'auth-card' }, [
        el('h2', {}, ['Log in']),
        form,
        el('p', { class: 'auth-switch' }, [
          "Don't have an account? ",
          el('a', { href: '#/register' }, ['Create one']),
        ]),
      ]),
    ])
  );
}

function renderRegister() {
  if (Session.get()) { location.hash = '#/events'; return; }
  app.innerHTML = '';

  const firstInput = el('input', { type: 'text', placeholder: 'First name' });
  const lastInput = el('input', { type: 'text', placeholder: 'Last name' });
  const emailInput = el('input', { type: 'email', placeholder: 'your@email.com' });
  const passwordInput = el('input', { type: 'password', placeholder: 'Min. 6 characters' });

  const form = el('form', {}, [
    el('div', { class: 'field-row' }, [
      el('label', {}, ['First name', firstInput]),
      el('label', {}, ['Last name', lastInput]),
    ]),
    el('label', {}, ['Email', emailInput]),
    el('label', {}, ['Password', passwordInput]),
    el('button', { type: 'submit', class: 'btn btn--primary', style: 'width:100%;margin-top:8px;' }, ['Create account']),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!firstInput.value.trim()) { toast('First name is required'); firstInput.focus(); return; }
    if (passwordInput.value.length < 6) { toast('Password must be at least 6 characters'); passwordInput.focus(); return; }
    try {
      const { user } = await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: firstInput.value.trim(),
          lastName: lastInput.value.trim() || null,
          email: emailInput.value.trim(),
          password: passwordInput.value,
        }),
      });
      Session.set(user);
      location.hash = '#/events';
      router();
    } catch (err) { toast(err.message); }
  });

  app.appendChild(
    el('div', { class: 'auth-wrap' }, [
      el('div', { class: 'auth-card' }, [
        el('h2', {}, ['Create account']),
        form,
        el('p', { class: 'auth-switch' }, [
          'Already have an account? ',
          el('a', { href: '#/login' }, ['Log in']),
        ]),
      ]),
    ])
  );
}

// ---- Boot ----------------------------------------------------------

async function refreshSession() {
  if (!Session.get()) return;
  try {
    const { profile } = await api('/api/profile');
    Session.set(profile);
  } catch { /* 401 is handled inside api() — session already cleared */ }
}

renderIdentity();
refreshSession().then(() => router());
