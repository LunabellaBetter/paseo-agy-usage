// Read only the go-keyring item used by agy. No enumeration or credential writes.
// EncodedCommand avoids shell interpolation; secrets are returned on stdout only
// to the parent process, never embedded in argv or included in error messages.
export const WINDOWS_CREDENTIAL_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class AgyCredential {
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static string Read() {
        IntPtr pointer;
        if (!CredRead("gemini:antigravity", 1, 0, out pointer)) {
            int code = Marshal.GetLastWin32Error();
            if (code == 1168) return null;
            throw new Win32Exception(code);
        }
        try {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            byte[] bytes = new byte[checked((int)credential.CredentialBlobSize)];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.UTF8.GetString(bytes);
        } finally {
            CredFree(pointer);
        }
    }
}
'@
$value = [AgyCredential]::Read()
if ($null -ne $value) { [Console]::Out.Write($value) }
`;
