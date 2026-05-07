# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class VlrItem(scrapy.Item):
    username = scrapy.Field()
    flag = scrapy.Field()
    flair = scrapy.Field()

    total_posts = scrapy.Field()

    net_votes = scrapy.Field()
    upvotes = scrapy.Field()
    downvotes = scrapy.Field()
    longest_streak = scrapy.Field()

    # list of dicts: {url, frags, text}
    top_posts = scrapy.Field()  
    # list of dicts: {username, reply_count}
    biggest_fans = scrapy.Field() 
