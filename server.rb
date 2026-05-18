require 'webrick'

port = (ENV['PORT'] || '8080').to_i
root = '/Users/lemon/Desktop/off-stage'

# Custom file handler that adds no-cache headers to every response
class NoCacheHandler < WEBrick::HTTPServlet::FileHandler
  def do_GET(req, res)
    super
    res['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    res['Pragma']        = 'no-cache'
    res['Expires']       = '0'
  end
end

server = WEBrick::HTTPServer.new(Port: port, DocumentRoot: root)
server.mount('/', NoCacheHandler, root)

trap('INT') { server.shutdown }
server.start
