# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class VlrItem(scrapy.Item):
    username = scrapy.Field()
    flag = scrapy.Field()
    flair = scrapy.Field()
    registered_date = scrapy.Field()
    year = scrapy.Field()

    total_posts = scrapy.Field()

    net_votes = scrapy.Field()
    upvotes = scrapy.Field()
    downvotes = scrapy.Field()
    longest_streak = scrapy.Field()
    dead_posts = scrapy.Field()
    most_active_month = scrapy.Field()

    top_posts = scrapy.Field()
    biggest_fans = scrapy.Field()
