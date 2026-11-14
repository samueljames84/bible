package local.bible.malayalam;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "BookmarkBackup")
public class BookmarkBackupPlugin extends Plugin {
    @PluginMethod
    public void exportFile(PluginCall call) {
        if (call.getString("content") == null) {
            call.reject("Bookmark backup content is missing.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "bible-bookmarks.json");
        try {
            startActivityForResult(call, intent, "exportResult");
        } catch (ActivityNotFoundException error) {
            call.reject("No file picker is available.", error);
        }
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK) {
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            call.reject("The file picker did not return a destination.");
            return;
        }
        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("Could not open the selected destination.");
            output.write(call.getString("content").getBytes(StandardCharsets.UTF_8));
        } catch (IOException | SecurityException | IllegalArgumentException error) {
            call.reject("Could not write the bookmark backup.", error);
            return;
        }
        response.put("cancelled", false);
        call.resolve(response);
    }
}
