<?php
// Throwaway helper: prints the absolute server path of the folder it sits in,
// which is what AuthUserFile in .htaccess needs.
//
// 1. Upload this next to .htaccess, inside the lele folder.
// 2. Open https://<your-domain>/lele/whereami.php in a browser.
// 3. Paste the path it prints into .htaccess, replacing
//    __ABSOLUTE_PATH_TO_LELE__
// 4. DELETE THIS FILE.
//
// Note: you will need to comment out the Require valid-user line to reach this
// page, or run it before uploading .htaccess — otherwise Apache asks for a
// password that cannot work yet, because AuthUserFile still points nowhere.
header('Content-Type: text/plain; charset=utf-8');
echo "AuthUserFile path for .htaccess:\n\n";
echo __DIR__ . "/.htpasswd\n\n";
echo "Replace __ABSOLUTE_PATH_TO_LELE__ with:\n" . __DIR__ . "\n\n";
echo "Then delete this file.\n";
