import java.io.File;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;

// Local inspection only. Images of licensed artwork must stay outside product archives.
public class RenderLocalReview {
    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("Expected PDF, one-based page number and local PNG path");
        try (PDDocument document = Loader.loadPDF(new File(args[0]))) {
            int page = Integer.parseInt(args[1]) - 1;
            if (page < 0 || page >= document.getNumberOfPages()) throw new IllegalArgumentException("Invalid page");
            ImageIO.write(new PDFRenderer(document).renderImageWithDPI(page, 96), "png", new File(args[2]));
        }
    }
}
