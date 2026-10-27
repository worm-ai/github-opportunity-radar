import java.awt.image.BufferedImage;
import java.io.File;
import java.util.Locale;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;

// Local pixel comparison only. No page images or artwork are exported.
public class ComparePdfRendering {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected input and output PDF");
        long started = System.nanoTime();
        try (PDDocument before = Loader.loadPDF(new File(args[0]));
             PDDocument after = Loader.loadPDF(new File(args[1]))) {
            int count = before.getNumberOfPages();
            if (count < 1 || count > 100 || count != after.getNumberOfPages())
                throw new IllegalArgumentException("Invalid or different page counts");
            PDFRenderer left = new PDFRenderer(before), right = new PDFRenderer(after);
            System.out.print("{\"renderer\":\"PDFBox bundled with OpenDataLoader 2.5.13\",\"dpi\":72,\"pages\":[");
            long totalDifferent = 0;
            for (int i = 0; i < count; i++) {
                BufferedImage a = left.renderImageWithDPI(i, 72, ImageType.RGB);
                BufferedImage b = right.renderImageWithDPI(i, 72, ImageType.RGB);
                boolean sameDimensions = a.getWidth() == b.getWidth() && a.getHeight() == b.getHeight();
                long different = 0;
                if (sameDimensions) {
                    for (int y = 0; y < a.getHeight(); y++)
                        for (int x = 0; x < a.getWidth(); x++)
                            if (a.getRGB(x, y) != b.getRGB(x, y)) different++;
                } else different = (long) a.getWidth() * a.getHeight();
                totalDifferent += different;
                if (i > 0) System.out.print(",");
                System.out.print("{\"page\":" + (i + 1) + ",\"sameDimensions\":" + sameDimensions +
                                 ",\"differentPixels\":" + different + "}");
                a.flush(); b.flush();
            }
            System.out.printf(Locale.ROOT, "],\"totalDifferentPixels\":%d,\"seconds\":%.3f,\"exportedImages\":0}%n",
                              totalDifferent, (System.nanoTime() - started) / 1e9);
        }
    }
}
