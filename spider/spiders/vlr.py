import re
import json
import os
import scrapy
from spider.items import VlrItem
from datetime import datetime, timedelta

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
_DATA_DIR = os.path.join(_ROOT, 'data')


class UserPostsSpider(scrapy.Spider):
    name = 'vlr'
    allowed_domains = ['vlr.gg']

    def __init__(self, username=None, year=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.username = username
        self.year = int(year) if year else None
        self.start_urls = [f'https://vlr.gg/user/{username}']

        self.upvotes = 0
        self.downvotes = 0
        self.all_posts = []
        self.reply_users = {}
        self.processed_post_ids = set()
        self.processed_reply_ids = set()

        self.flag = None
        self.flair = None
        self.registered_date = None
        self.dead_posts = 0
        self.posts_by_month = {}
        self.current_page = 0

    async def start(self):
        yield scrapy.Request(self.start_urls[0], callback=self.parse_profile)

    async def parse_profile(self, response):
        # registered date: find the row where first <td> text is 'Registered:'
        for row in response.css('table tr'):
            cells = row.css('td::text').getall()
            if len(cells) >= 2 and cells[0].strip() == 'Registered:':
                self.registered_date = cells[1].strip()
                break

        page_links = response.css('a.btn.mod-page::attr(href)').getall()
        self.last_page = int(page_links[-1].split('=')[-1]) if page_links else 1

        # start lazy pagination from page 1
        yield response.follow(
            f'/user/{self.username}/?page=1',
            callback=self.parse_user_page,
            cb_kwargs={'page': 1}
        )

    async def parse_user_page(self, response, page=1):
        self.current_page = page
        cards = response.css('div.wf-card.ge-text-light')
        all_too_old = True

        for card in cards:
            link = card.css('a[href*="/post/"]::attr(href)').get('')
            if not link:
                continue

            if self.year:
                # the date is always in the last div child of the card
                date_text = card.css('div:last-child::text').getall()
                date_text = ' '.join(t.strip() for t in date_text).strip().lower()
                approx_dt = self._approx_date_from_relative(date_text)

                if approx_dt is not None:
                    year_start = datetime(self.year, 1, 1)
                    year_end   = datetime(self.year, 12, 31)
                    # 30-day grace since vlr relative dates are fuzzy and can bleed across year boundaries
                    if approx_dt + timedelta(days=30) < year_start:
                        # too old even with grace - skip
                        continue
                    if approx_dt > year_end:
                        # too recent - skip but keep paginating
                        all_too_old = False
                        continue

                all_too_old = False
                yield response.follow(link, callback=self.parse_discussion)
            else:
                all_too_old = False
                yield response.follow(link, callback=self.parse_discussion)

        # stop paginating once every post on this page is older than target year
        if not all_too_old and page < self.last_page:
            yield response.follow(
                f'/user/{self.username}/?page={page + 1}',
                callback=self.parse_user_page,
                cb_kwargs={'page': page + 1}
            )

    def _approx_date_from_relative(self, date_text):
        # returns approximate datetime from relative date string, or None
        now = datetime.now()
        if not date_text:
            return None
        if 'minute' in date_text or 'hour' in date_text:
            return now
        m = re.search(r'(\d+)\s+day', date_text)
        if m:
            return now - timedelta(days=int(m.group(1)))
        m = re.search(r'(\d+)\s+week', date_text)
        if m:
            return now - timedelta(weeks=int(m.group(1)))
        m = re.search(r'(\d+)\s+month', date_text)
        if m:
            months = int(m.group(1))
            month = now.month - months
            year = now.year
            while month <= 0:
                month += 12
                year -= 1
            return now.replace(year=year, month=month)
        m = re.search(r'about\s+(\d+)\s+year', date_text)
        if m:
            return now.replace(year=now.year - int(m.group(1)))
        if 'year' in date_text:
            return now.replace(year=now.year - 1)
        return None

    async def parse_discussion(self, response):
        # find all posts by this user on this page
        user_posts = response.css(
            f'a.post-header-author[href*="/user/{self.username}"]'
        )

        for post_author in user_posts:
            post_container = post_author.xpath(
                "./ancestor::div[contains(@class,'wf-card post')]"
            )

            post_id = post_container.attrib.get('data-post-id', '')
            if not post_id or post_id in self.processed_post_ids:
                continue
            self.processed_post_ids.add(post_id)

            # flag / flair (only need once)
            if self.flag is None:
                flag_el = post_container.css('i.post-header-flag')
                self.flag = flag_el.attrib.get('title', '') if flag_el else ''

            if self.flair is None:
                flair_el = post_container.css('a img.post-header-flair')
                self.flair = flair_el.attrib.get('src', '') if flair_el else ''

            # get exact date from post-footer js-date-toggle title attr
            date_title = post_container.css('div.post-footer span.js-date-toggle::attr(title)').get('').strip()
            post_datetime = None
            if date_title:
                # title is like "Mar 12, 2026 at 1:48 AM CET" or "Mar 12, 2026 at 1:48 AM -05"
                # just grab the "Mon DD, YYYY" part at the start
                m = re.search(r'([A-Za-z]+ \d+, \d{4})', date_title)
                if m:
                    try:
                        post_datetime = datetime.strptime(m.group(1), '%b %d, %Y')
                    except ValueError:
                        pass
            post_year = post_datetime.year if post_datetime else None

            # skip only if we definitively know it's the wrong year - if date unknown, count it
            if self.year:
                if post_year is not None and post_year != self.year:
                    continue

            # frags
            frag_div = post_container.css('div.post-frag-count')
            frag_raw = frag_div.css('::text').get('0').strip()
            frags = int(frag_raw) if frag_raw.lstrip('-').isdigit() else 0

            if frags > 0:
                self.upvotes += frags
            elif frags < 0:
                self.downvotes += frags

            # post text
            text_nodes = post_container.css('div.post-body *::text').getall()
            text = ' '.join(t.strip() for t in text_nodes if t.strip())

            # post url 
            post_url = post_container.css(
                'a.post-action.link::attr(href)'
            ).get('')
            post_url = response.urljoin(post_url)

            if frags == 0:
                self.dead_posts += 1

            if post_datetime:
                month_key = post_datetime.strftime('%B')
                self.posts_by_month[month_key] = self.posts_by_month.get(month_key, 0) + 1

            self.all_posts.append({'url': post_url, 'frags': frags, 'text': text, 'date': post_datetime})

            # write progress every 10 posts to avoid hammering disk
            current = len(self.all_posts)
            if current % 50 == 0:
                try:
                    progress_path = os.path.join(_DATA_DIR, f'{self.username}.progress')
                    try:
                        with open(progress_path, 'r') as _pf:
                            written = int(_pf.read().strip())
                    except (OSError, ValueError):
                        written = 0
                    if current > written:
                        with open(progress_path, 'w') as _pf:
                            _pf.write(str(current))
                except OSError:
                    pass

            # replies to this post (biggest fans)
            thread = post_author.xpath(
                "./ancestor::div[contains(@class,'threading')]"
                "/div[contains(@class,'threading')]"
            )
            reply_authors = thread.css('a.post-header-author::text').getall()
            reply_ids = thread.css('div.report-form::attr(data-post-id)').getall()

            for reply_id, reply_username in zip(reply_ids, reply_authors):
                reply_username = reply_username.strip()
                if (
                    reply_username
                    and reply_username != self.username
                    and reply_id not in self.processed_reply_ids
                ):
                    self.processed_reply_ids.add(reply_id)
                    self.reply_users[reply_username] = (
                        self.reply_users.get(reply_username, 0) + 1
                    )

        # follow "continue thread" links
        for link in response.css('a:contains("continue thread")::attr(href)').getall():
            yield response.follow(link, callback=self.parse_discussion)

    def _longest_streak(self):
        dates = sorted(set(
            p['date'].date()
            for p in self.all_posts if p.get('date')
        ))
        if not dates:
            return 0
        best = streak = 1
        for i in range(1, len(dates)):
            if (dates[i] - dates[i - 1]).days == 1:
                streak += 1
                best = max(best, streak)
            else:
                streak = 1
        return best

    def closed(self, reason):
        top5 = sorted(self.all_posts, key=lambda p: abs(p['frags']), reverse=True)[:5]
        top10_fans = sorted(
            self.reply_users.items(), key=lambda x: x[1], reverse=True
        )[:10]

        most_active_month = max(self.posts_by_month, key=self.posts_by_month.get) if self.posts_by_month else ''

        item = VlrItem(
            username=self.username,
            flag=self.flag or '',
            flair=self.flair or '',
            registered_date=self.registered_date or '',
            year=self.year,
            total_posts=len(self.all_posts),
            net_votes=self.upvotes + self.downvotes,
            upvotes=self.upvotes,
            downvotes=self.downvotes,
            longest_streak=self._longest_streak(),
            dead_posts=self.dead_posts,
            most_active_month=most_active_month,
            top_posts=top5,
            biggest_fans=[{'username': u, 'reply_count': c} for u, c in top10_fans],
        )
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(os.path.join(_DATA_DIR, f'{self.username}.json'), 'w', encoding='utf-8') as f:
            json.dump(dict(item), f, indent=2, default=str)
        progress_file = os.path.join(_DATA_DIR, f'{self.username}.progress')
        try:
            os.remove(progress_file)
        except OSError:
            pass