import scrapy
from spider.items import VlrItem


class UserPostsSpider(scrapy.Spider):
    name = 'vlr'
    allowed_domains = ['vlr.gg']

    def __init__(self, username=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.username = username
        self.start_urls = [f'https://vlr.gg/user/{username}']

        self.upvotes = 0
        self.downvotes = 0
        self.all_posts = []       
        self.reply_users = {}     
        self.processed_post_ids = set()
        self.processed_reply_ids = set()

        # flag/flair grabbed from first post we encounter
        self.flag = None
        self.flair = None

    async def start(self):
        yield scrapy.Request(self.start_urls[0], callback=self.parse_profile)

    async def parse_profile(self, response):

        page_links = response.css('a.btn.mod-page::attr(href)').getall()
        last_page = int(page_links[-1].split('=')[-1]) if page_links else 1

        for page in range(1, last_page + 1):
            yield response.follow(
                f'/user/{self.username}/?page={page}',
                callback=self.parse_user_page
            )

    async def parse_user_page(self, response):
        discussion_links = response.css('div.wf-card.ge-text-light a::attr(href)').getall()
        for link in discussion_links:
            yield response.follow(link, callback=self.parse_discussion)

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

            self.all_posts.append({'url': post_url, 'frags': frags, 'text': text})

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
        """Longest consecutive streak of posts with frags > 0."""
        best = streak = 0
        for p in self.all_posts:
            if p['frags'] > 0:
                streak += 1
                best = max(best, streak)
            else:
                streak = 0
        return best

    def closed(self, reason):
        top5 = sorted(self.all_posts, key=lambda p: abs(p['frags']), reverse=True)[:5]
        top10_fans = sorted(
            self.reply_users.items(), key=lambda x: x[1], reverse=True
        )[:10]

        item = VlrItem(
            username=self.username,
            flag=self.flag or '',
            flair=self.flair or '',
            total_posts=len(self.all_posts),
            net_votes=self.upvotes + self.downvotes,
            upvotes=self.upvotes,
            downvotes=self.downvotes,
            longest_streak=self._longest_streak(),
            top_posts=top5,
            biggest_fans=[{'username': u, 'reply_count': c} for u, c in top10_fans],
        )
        import json, os
        root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        data_dir = os.path.join(root, 'data')
        os.makedirs(data_dir, exist_ok=True)
        with open(os.path.join(data_dir, f'{self.username}.json'), 'w', encoding='utf-8') as f:
            json.dump(dict(item), f, indent=2, default=str)