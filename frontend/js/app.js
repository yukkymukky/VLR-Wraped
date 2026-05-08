let countries = [];
let logos = {};

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCountries(), loadLogos()]);
  initScrapeForm();
  await loadFromUrl();
});

const loadLogos = async () => {
  try {
    const res = await fetch('logos.json');
    logos = await res.json();
  } catch (err) {
    console.warn('Could not load logos.json', err);
  }
};

const loadCountries = async () => {
  try {
    const res = await fetch('countries.json');
    countries = await res.json();
  } catch (err) {
    console.warn('Could not load countries.json - flags will not be shown.', err);
  }
};

const getCountryCode = (name) => {
  if (!name || !countries.length) return null;
  const entry = countries.find(c => c.label.toLowerCase() === name.toLowerCase());
  return entry ? entry.value.toLowerCase() : null;
};

const buildFlagImg = (name) => {
  const code = getCountryCode(name);
  if (!code) return '';
  return `<span class="fi fi-${code}" title="${name}"></span>`;
};

const loadFromUrl = async () => {
  const params = new URLSearchParams(window.location.search);
  const username = params.get('username') || '';
  const year     = params.get('year') || '';
  if (!username) return;

  document.getElementById('usernameInput').value = username;
  document.getElementById('yearInput').value = year;

  const status = document.getElementById('scrapeStatus');
  try {
    let url = `/api/cached?username=${encodeURIComponent(username)}`;
    if (year) url += `&year=${encodeURIComponent(year)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      renderCard(data);
    }
  } catch {
    // silently ignore — user can manually re-generate
  }
};

const initScrapeForm = () => {
  const form      = document.getElementById('scrapeForm');
  const status    = document.getElementById('scrapeStatus');
  const fileInput = document.getElementById('fileInput');

  // file upload — load JSON directly without hitting the server
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        status.textContent = '';
        status.className = 'input-status';
        renderCard(data);
      } catch {
        status.textContent = 'Invalid JSON file.';
        status.className = 'input-status error';
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('usernameInput').value.trim();
    const year     = document.getElementById('yearInput').value.trim();
    if (!username) return;

    // Update URL so state survives a refresh
    const params = new URLSearchParams();
    params.set('username', username);
    if (year) params.set('year', year);
    window.history.pushState({}, '', '?' + params.toString());

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    submitBtn.dataset.label = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="loader"></span>';

    // Inject cancel button right after the submit button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-cancel';
    cancelBtn.title = 'Cancel';
    cancelBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
    submitBtn.insertAdjacentElement('afterend', cancelBtn);

    status.textContent = '';
    status.className = 'input-status';

    let currentJobId = null;
    let pollInterval = null;
    let countRaf     = null;

    const resetForm = () => {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.textContent = submitBtn.dataset.label;
      cancelBtn.remove();
    };

    cancelBtn.onclick = async () => {
      if (pollInterval) clearInterval(pollInterval);
      if (countRaf) cancelAnimationFrame(countRaf);
      if (currentJobId) {
        try { await fetch(`/api/cancel/${currentJobId}`, { method: 'POST' }); } catch {}
      }
      status.textContent = 'Cancelled.';
      status.className = 'input-status';
      resetForm();
    };

    try {
      let url = `/api/scrape?username=${encodeURIComponent(username)}`;
      if (year) url += `&year=${encodeURIComponent(year)}`;
      const startRes = await fetch(url);
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${startRes.status}`);
      }
      const { job_id } = await startRes.json();
      currentJobId = job_id;

      // Poll until done or error
      let displayedCount = 0;
      let targetCount    = 0;

      const startTicker = () => {
        const tick = () => {
          if (targetCount > displayedCount) {
            displayedCount += (targetCount - displayedCount) * 0.06;
            if (targetCount - displayedCount < 0.5) displayedCount = targetCount;
            const shown = Math.floor(displayedCount);
            status.textContent = `Scraped ${shown} post${shown === 1 ? '' : 's'} so far…`;
          }
          countRaf = requestAnimationFrame(tick);
        };
        countRaf = requestAnimationFrame(tick);
      };

      const onPoll = (newCount) => {
        if (newCount > targetCount) targetCount = newCount;
      };

      startTicker();

      const data = await new Promise((resolve, reject) => {
        pollInterval = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/status/${job_id}`);
            const job = await pollRes.json();
            if (job.status === 'done') {
              clearInterval(pollInterval);
              cancelAnimationFrame(countRaf);
              resolve(job.data);
            } else if (job.status === 'error') {
              clearInterval(pollInterval);
              cancelAnimationFrame(countRaf);
              reject(new Error(job.error || 'Spider failed'));
            } else if (job.status === 'cancelled') {
              clearInterval(pollInterval);
              cancelAnimationFrame(countRaf);
              reject(new Error('cancelled'));
            } else {
              if (job.posts_scraped != null) onPoll(job.posts_scraped);
            }
          } catch (e) {
            clearInterval(pollInterval);
            cancelAnimationFrame(countRaf);
            reject(e);
          }
        }, 2000);
      });

      status.innerHTML = '';
      renderCard(data);
    } catch (err) {
      if (err.message !== 'cancelled') {
        status.innerHTML = '';
        status.textContent = err.message;
        status.className = 'input-status error';
      }
    } finally {
      resetForm();
    }
  });
};

const slugFromUrl = (url) => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch {
    return url;
  }
};

const truncate = (str, len) => {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
};

const signed = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toLocaleString();

const renderCard = (data) => {
  renderHeader(data);
  renderStats(data);
  renderMiniStats(data);
  renderTopPosts(data.top_posts || []);
  renderBiggestFans(data.biggest_fans || []);

  const section = document.getElementById('cardSection');
  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth' });
};

const renderHeader = (data) => {
  document.title = `${data.username}'s VLR Card`;

  const titleEl = document.getElementById('cardTitle');
  titleEl.textContent = data.year ? `VLR WRAPPED ${data.year}` : 'VLR WRAPPED LIFETIME';

  document.getElementById('cardFlag').innerHTML = buildFlagImg(data.flag);
  document.getElementById('cardUsername').textContent = data.username;

  const flairEl = document.getElementById('cardFlair');
  if (data.flair) {
    // look up dark logo by matching scraped flair URL against logos.json
    const scraped = data.flair.replace(/^https?:/, '');
    const match = Object.values(logos).find(v => v.light_logo === scraped || v.dark_logo === scraped);
    const resolved = match?.dark_logo || scraped;
    flairEl.src = resolved.startsWith('//') ? 'https:' + resolved : resolved;
    flairEl.hidden = false;
  } else {
    flairEl.hidden = true;
  }
};

const calcPostsPerMonth = (data) => {
  const total = data.total_posts;
  if (!total) return null;

  const year = data.year;
  const now = new Date();

  if (year) {
    // specific year: divide by 12, or by months elapsed if it's the current year
    const months = (year < now.getFullYear())
      ? 12
      : now.getMonth() + 1; // months elapsed in current year (1-indexed)
    return (total / months).toFixed(1);
  }

  // lifetime: divide by months since registered
  if (!data.registered_date) return null;
  const reg = new Date(data.registered_date);
  if (isNaN(reg)) return null;
  const monthsElapsed =
    (now.getFullYear() - reg.getFullYear()) * 12 +
    (now.getMonth() - reg.getMonth()) + 1;
  if (monthsElapsed < 1) return null;
  return (total / monthsElapsed).toFixed(1);
};

const calcAvgDailyPosts = (data) => {
  const total = data.total_posts;
  if (!total) return null;

  const year = data.year;
  const now = new Date();

  if (year) {
    const isCurrentYear = year >= now.getFullYear();
    const days = isCurrentYear
      ? Math.ceil((now - new Date(now.getFullYear(), 0, 1)) / 86400000)
      : (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365);
    return (total / days).toFixed(2);
  }

  if (!data.registered_date) return null;
  const reg = new Date(data.registered_date);
  if (isNaN(reg)) return null;
  const daysElapsed = Math.max(1, Math.ceil((now - reg) / 86400000));
  return (total / daysElapsed).toFixed(2);
};

const renderMiniStats = (data) => {
  const avgDaily = calcAvgDailyPosts(data);
  document.getElementById('miniAvgDaily').textContent = avgDaily ?? '—';

  const deadPct = data.total_posts > 0 && data.dead_posts != null
    ? ((data.dead_posts / data.total_posts) * 100).toFixed(2) + '%'
    : '—';
  document.getElementById('miniDeadPosts').textContent = deadPct;
};

const renderStats = (data) => {
  document.getElementById('statTotalPosts').textContent = data.total_posts != null ? data.total_posts.toLocaleString() : '—';

  // posts per month sub-label
  const ppmEl = document.getElementById('statPostsPerMonth');
  const ppm = calcPostsPerMonth(data);
  ppmEl.textContent = ppm ? `About ${ppm} posts per month` : '';
  const netEl = document.getElementById('statNetVotes');
  netEl.textContent = signed(data.net_votes);
  netEl.className = 'stat-big ' + (data.net_votes >= 0 ? 'positive' : 'negative');

  const totalVotes = data.upvotes + Math.abs(data.downvotes);
  const upPct   = totalVotes > 0 ? (data.upvotes / totalVotes) * 100 : 0;
  const downPct = totalVotes > 0 ? (Math.abs(data.downvotes) / totalVotes) * 100 : 0;
  document.getElementById('votesUp').style.width   = upPct + '%';
  document.getElementById('votesDown').style.width = downPct + '%';
  document.getElementById('votesSub').textContent =
    `${data.upvotes != null ? data.upvotes.toLocaleString() : '—'} upvotes, ${data.downvotes != null ? Math.abs(data.downvotes).toLocaleString() : '—'} downvotes`;

  document.getElementById('statStreak').textContent = data.longest_streak != null ? data.longest_streak.toLocaleString() + (data.longest_streak === 1 ? ' DAY' : ' DAYS') : '—';
  document.getElementById('statActiveMonth').textContent =
    data.most_active_month ? `Most active in ${data.most_active_month}` : '';
};

const renderTopPosts = (posts) => {
  const container = document.getElementById('topPosts');
  container.innerHTML = '';

  posts.forEach(post => {
    const slug      = slugFromUrl(post.url);
    const fragStr   = signed(post.frags);
    const fragClass = post.frags >= 0 ? 'positive' : 'negative';

    const row = document.createElement('a');
    row.className = 'post-row';
    row.href      = post.url;
    row.target    = '_blank';
    row.rel       = 'noopener noreferrer';
    row.innerHTML = `
      <div class="post-info">
        <div class="post-slug">${slug}</div>
        <div class="post-text">${truncate(post.text, 70)}</div>
      </div>
      <span class="post-frags ${fragClass}">${fragStr}</span>
    `;
    container.appendChild(row);
  });
};

const renderBiggestFans = (fans) => {
  const container = document.getElementById('biggestFans');
  container.innerHTML = '';

  fans.forEach(fan => {
    const tag = document.createElement('div');
    tag.className = 'fan-tag';
    tag.innerHTML = `
      <span>${fan.username}</span>
      <span class="fan-count">${fan.reply_count}</span>
    `;
    container.appendChild(tag);
  });
};
