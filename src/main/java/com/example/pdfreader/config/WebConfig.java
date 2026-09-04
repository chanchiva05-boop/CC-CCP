package com.example.pdfreader.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // កំណត់ឲ្យ Spring អាចចូលមើលឯកសារ PDF ពី Folder ខាងក្រៅ
        registry.addResourceHandler("/pdfs/**")
                .addResourceLocations("file:./src/main/webapp/pdfs/");
        
        // កំណត់ឲ្យ Spring អាចចូលមើលឯកសារឋិតិវន្ត (CSS, JS, Images)
        registry.addResourceHandler("/static/**")
                .addResourceLocations("classpath:/static/");
    }
}
