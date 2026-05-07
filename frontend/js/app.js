let countries = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadCountries();
  initScrapeForm();
});

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

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    // Animated dots while waiting
    let dotCount = 0;
    const dotInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      status.textContent = 'Scraping' + '.'.repeat(dotCount);
      status.className = 'input-status';
    }, 500);

    try {
      let url = `/api/scrape?username=${encodeURIComponent(username)}`;
      if (year) url += `&year=${encodeURIComponent(year)}`;
      const startRes = await fetch(url);
      if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${startRes.status}`);
      }
      const { job_id } = await startRes.json();

      // Poll until done or error
      const data = await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/status/${job_id}`);
            const job = await pollRes.json();
            if (job.status === 'done') {
              clearInterval(poll);
              resolve(job.data);
            } else if (job.status === 'error') {
              clearInterval(poll);
              reject(new Error(job.error || 'Spider failed'));
            }
            // still "running", keep polling
          } catch (e) {
            clearInterval(poll);
            reject(e);
          }
        }, 2000);
      });

      status.textContent = '';
      renderCard(data);
    } catch (err) {
      status.textContent = err.message;
      status.className = 'input-status error';
    } finally {
      clearInterval(dotInterval);
      submitBtn.disabled = false;
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
  const titleEl = document.getElementById('cardTitle');
  titleEl.textContent = data.year ? `VLR WRAPPED ${data.year}` : 'VLR WRAPPED LIFETIME';

  document.getElementById('cardFlag').innerHTML = buildFlagImg(data.flag);
  document.getElementById('cardUsername').textContent = data.username;

  const flairEl = document.getElementById('cardFlair');
  if (data.flair) {
    // flair URLs from vlr are protocol-relative (//owcdn.net/...)
    flairEl.src = data.flair.startsWith('//') ? 'https:' + data.flair : data.flair;
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
