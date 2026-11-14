package local.bible.malayalam;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BookmarkBackupPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
