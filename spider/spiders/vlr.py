import scrapy
import requests

class UserPostsSpider(scrapy.Spider):
    name = 'vlr'
    allowed_domains = ['vlr.gg']
    base_url = 'https://vlr.gg'

    async def start(self):
        yield scrapy.Request(self.base_url, callback=self.parse_listpage)

    async def parse_listpage(self, response):
        product_urls = response.css("article.product_pod h3 a::attr(href)").getall()
        for url in product_urls:
            yield response.follow(url, callback=self.parse_book)

        next_page_url = response.css("li.next a::attr(href)").get()
        if next_page_url:
            yield response.follow(next_page_url, callback=self.parse_listpage)
    
    async def parse_book(self, response):
        yield {
            "name": response.css("h1::text").get(),
            "price": response.css("p.price_color::text").get(),
            "url": response.url
        }