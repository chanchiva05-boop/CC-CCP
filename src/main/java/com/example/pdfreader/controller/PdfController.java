package com.example.pdfreader.controller;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

@Controller
public class PdfController {

    @Value("${pdf.storage.path}")
    private String storagePath;

    // 📄 ទំព័រដើម - បង្ហាញបញ្ជី PDF
    @GetMapping("/")
    public String index(Model model) throws IOException {
        List<String> pdfFiles = getPdfFiles();
        model.addAttribute("files", pdfFiles);
        return "index";
    }

    // 📤 Upload PDF
    @PostMapping("/upload")
    public String uploadPdf(@RequestParam("file") MultipartFile file) throws IOException {
        if (!file.isEmpty() && file.getOriginalFilename().toLowerCase().endsWith(".pdf")) {
            Path path = Paths.get(storagePath + File.separator + file.getOriginalFilename());
            Files.createDirectories(path.getParent());
            file.transferTo(path.toFile());
        }
        return "redirect:/";
    }

    // 🗑️ លុប PDF
    @PostMapping("/delete/{filename}")
    public String deletePdf(@PathVariable String filename) throws IOException {
        Path path = Paths.get(storagePath + File.separator + filename);
        Files.deleteIfExists(path);
        return "redirect:/";
    }

    // 📖 អាន PDF និងបង្ហាញជា Base64 (សម្រាប់បង្ហាញក្នុង Browser)
    @GetMapping("/view/{filename}")
    public String viewPdf(@PathVariable String filename, Model model) throws IOException {
        Path path = Paths.get(storagePath + File.separator + filename);
        if (!Files.exists(path)) {
            return "redirect:/";
        }

        // អាន PDF ហើយបង្វែរជា Base64
        try (PDDocument document = PDDocument.load(path.toFile())) {
            PDFRenderer renderer = new PDFRenderer(document);
            List<String> images = new ArrayList<>();

            for (int page = 0; page < document.getNumberOfPages(); page++) {
                BufferedImage image = renderer.renderImage(page);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                ImageIO.write(image, "png", baos);
                byte[] imageBytes = baos.toByteArray();
                String base64 = Base64.getEncoder().encodeToString(imageBytes);
                images.add(base64);
            }

            model.addAttribute("images", images);
            model.addAttribute("filename", filename);
            return "view";
        }
    }

    // 📥 ទាញយក PDF
    @GetMapping("/download/{filename}")
    public ResponseEntity<Resource> downloadPdf(@PathVariable String filename) throws IOException {
        Path path = Paths.get(storagePath + File.separator + filename);
        Resource resource = new FileSystemResource(path.toFile());
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
                .body(resource);
    }

    // អានបញ្ជី PDF ទាំងអស់
    private List<String> getPdfFiles() throws IOException {
        List<String> files = new ArrayList<>();
        Path dir = Paths.get(storagePath);
        Files.createDirectories(dir);
        Files.list(dir)
                .filter(p -> p.toString().toLowerCase().endsWith(".pdf"))
                .forEach(p -> files.add(p.getFileName().toString()));
        return files;
    }
                         }
