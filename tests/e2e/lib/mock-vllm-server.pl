#!/usr/bin/env perl
use strict;
use warnings;
use IO::Socket::INET;
use Cwd qw(abs_path);
use File::Basename qw(dirname);
use File::Spec;

my %options = (
    host => '127.0.0.1',
    paths => '/v1/chat/completions,/chat/completions',
);

for (my $i = 0; $i <= $#ARGV; $i++) {
    my $arg = $ARGV[$i];
    if ($arg eq '--context') {
        $options{context} = $ARGV[++$i];
    } elsif ($arg eq '--data-dir') {
        $options{'data-dir'} = $ARGV[++$i];
    } elsif ($arg eq '--response-files') {
        $options{'response-files'} = $ARGV[++$i];
    } elsif ($arg eq '--host') {
        $options{host} = $ARGV[++$i];
    } elsif ($arg eq '--paths') {
        $options{paths} = $ARGV[++$i];
    }
}

die "--context is required\n" unless $options{context};
my $script_dir = dirname(abs_path($0));
my $data_dir = $options{'data-dir'} || File::Spec->catdir(dirname($script_dir), 'data');
my %allowed = map { $_ => 1 } grep { length $_ } split /,/, $options{paths};
my @responses = load_responses(split_csv($options{'response-files'} || ''));
my $request_index = 0;

my $server = IO::Socket::INET->new(
    LocalAddr => $options{host},
    LocalPort => 0,
    Proto => 'tcp',
    Listen => 16,
    ReuseAddr => 1,
) or die "Failed to start mock server: $!\n";

my $port = $server->sockport();
my $origin = "http://$options{host}:$port";
write_file($options{context}, json_object(
    origin => $origin,
    baseUrl => "$origin/v1",
    responseCount => scalar(@responses),
) . "\n");
print "[full-mac:mock-vllm] $origin with " . scalar(@responses) . " queued responses\n";
$| = 1;

$SIG{TERM} = sub { close $server; exit 0; };
$SIG{INT} = sub { close $server; exit 0; };

while (my $client = $server->accept()) {
    $client->autoflush(1);
    my $request_line = <$client> || '';
    chomp $request_line;
    $request_line =~ s/\r$//;
    my ($method, $target) = $request_line =~ /^(\S+)\s+(\S+)/;
    my %headers;
    while (my $line = <$client>) {
        $line =~ s/\r?\n$//;
        last if $line eq '';
        if ($line =~ /^([^:]+):\s*(.*)$/) {
            $headers{lc $1} = $2;
        }
    }
    my $length = int($headers{'content-length'} || 0);
    my $body = '';
    read($client, $body, $length) if $length > 0;
    my ($path) = split /\?/, ($target || '/'), 2;

    if (($method || '') eq 'GET' && $path eq '/health') {
        send_json($client, 200, json_object(
            status => 'ok',
            queuedResponses => scalar(@responses),
            consumedResponses => $request_index,
        ));
        next;
    }

    if (($method || '') eq 'POST' && $path eq '/__admin/mock-responses') {
        if ($body =~ /"responseFiles"\s*:\s*\[(.*?)\]/s) {
            @responses = load_responses($1 =~ /"((?:\\.|[^"\\])*)"/g);
            $request_index = 0;
            send_json($client, 200, json_object(status => 'ok', queuedResponses => scalar(@responses)));
        } else {
            send_json($client, 400, '{"error":"Expected responseFiles in request body"}');
        }
        next;
    }

    if (($method || '') ne 'POST' || !$allowed{$path}) {
        send_json($client, 404, json_object(error => "Unhandled mock endpoint: " . ($method || 'UNKNOWN') . " $path"));
        next;
    }

    if ($request_index >= scalar(@responses)) {
        send_json($client, 500, json_object(
            error => 'Mock response queue exhausted',
            code => 'MOCK_RESPONSE_QUEUE_EXHAUSTED',
            configuredResponses => scalar(@responses),
            consumedResponses => $request_index,
            requestedPath => $path,
        ));
        next;
    }

    my $payload = $responses[$request_index++];
    if ($payload =~ /"__mockStatus"\s*:\s*(\d+)/) {
        my $status = $1;
        my $response_body = '{"error":"Mock provider error"}';
        if ($payload =~ /"__mockBody"\s*:\s*(\{.*\})\s*\}$/s) {
            $response_body = $1;
        }
        send_json($client, $status, $response_body);
        next;
    }

    send_json($client, 200, $payload);
}

sub split_csv {
    return grep { length $_ } split /,/, ($_[0] || '');
}

sub load_responses {
    my @files = @_;
    my @loaded;
    for my $file (@files) {
        $file =~ s/\\"/"/g;
        my $path = File::Spec->file_name_is_absolute($file)
            ? $file
            : File::Spec->catfile($data_dir, $file);
        open my $fh, '<', $path or die "Failed to open response file $path: $!\n";
        while (my $line = <$fh>) {
            $line =~ s/^\s+|\s+$//g;
            push @loaded, $line if length $line;
        }
        close $fh;
    }
    return @loaded;
}

sub write_file {
    my ($path, $content) = @_;
    open my $fh, '>', $path or die "Failed to write $path: $!\n";
    print {$fh} $content;
    close $fh;
}

sub send_json {
    my ($client, $status, $body) = @_;
    my %reason = (
        200 => 'OK',
        400 => 'Bad Request',
        402 => 'Payment Required',
        404 => 'Not Found',
        500 => 'Internal Server Error',
    );
    my $payload = $body . "\n";
    print {$client} "HTTP/1.1 $status " . ($reason{$status} || 'OK') . "\r\n";
    print {$client} "Content-Type: application/json; charset=utf-8\r\n";
    print {$client} "Content-Length: " . length($payload) . "\r\n";
    print {$client} "Connection: close\r\n\r\n";
    print {$client} $payload;
    close $client;
}

sub json_object {
    my @items = @_;
    my @pairs;
    while (@items) {
        my $key = shift @items;
        my $value = shift @items;
        my $encoded_value = defined($value) && $value =~ /^\d+$/
            ? $value
            : '"' . json_escape($value // '') . '"';
        push @pairs, '"' . json_escape($key) . '":' . $encoded_value;
    }
    return '{' . join(',', @pairs) . '}';
}

sub json_escape {
    my ($value) = @_;
    $value =~ s/\\/\\\\/g;
    $value =~ s/"/\\"/g;
    $value =~ s/\n/\\n/g;
    $value =~ s/\r/\\r/g;
    return $value;
}
