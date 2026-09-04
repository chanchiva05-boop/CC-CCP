package com.example.pdfreader;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class PdfReaderApplication {
    public static void main(String[] args) {
        SpringApplication.run(PdfReaderApplication.class, args);
        System.out.println("✅ Server started at: http://localhost:8080");
        System.out.println("📁 Put PDF files in: ./src/main/webapp/pdfs/");
    }
}
