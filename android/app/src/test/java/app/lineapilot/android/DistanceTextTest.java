package app.lineapilot.android;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static org.junit.Assert.*;
// Same table as app.js and iOS (tests/fixtures/distance-text.json).
public class DistanceTextTest {
    @Test public void sharedTable() throws Exception {
        Path file=Paths.get("../tests/fixtures/distance-text.json");
        if(!Files.exists(file))file=Paths.get("../../tests/fixtures/distance-text.json");
        if(!Files.exists(file))file=Paths.get("tests/fixtures/distance-text.json");
        String json=new String(Files.readAllBytes(file),StandardCharsets.UTF_8);
        Matcher row=Pattern.compile("\\[([0-9.]+),\"([^\"]*)\",\"([^\"]*)\"\\]").matcher(json);
        int count=0;
        while(row.find()){
            double metres=Double.parseDouble(row.group(1));
            assertEquals("display "+metres,row.group(2),DistanceText.display(metres));
            assertEquals("voice "+metres,row.group(3),DistanceText.spoken(metres));
            count++;
        }
        assertEquals(19,count);
    }
}
