package service

import (
	"io"
	"os"
	"testing"
)

func TestSendVerificationCodeDevLogIncludesClientIP(t *testing.T) {
	originalStdout := os.Stdout
	readPipe, writePipe, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = writePipe
	t.Cleanup(func() {
		os.Stdout = originalStdout
		_ = readPipe.Close()
		_ = writePipe.Close()
	})

	service := &EmailService{}
	if err := service.SendVerificationCode("user@example.com", "123456", "192.168.1.25"); err != nil {
		t.Fatalf("SendVerificationCode: %v", err)
	}
	if err := writePipe.Close(); err != nil {
		t.Fatalf("close stdout writer: %v", err)
	}
	os.Stdout = originalStdout

	output, err := io.ReadAll(readPipe)
	if err != nil {
		t.Fatalf("read stdout: %v", err)
	}
	want := "[DEV] Verification code for user@example.com: 123456 client_ip=192.168.1.25\n"
	if string(output) != want {
		t.Fatalf("verification log = %q, want %q", string(output), want)
	}
}
