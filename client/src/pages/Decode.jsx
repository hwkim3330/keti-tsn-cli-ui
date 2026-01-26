import { useState } from 'react'
import axios from 'axios'

function Decode() {
  const [cborInput, setCborInput] = useState('')
  const [inputFormat, setInputFormat] = useState('hex')
  const [outputFormat, setOutputFormat] = useState('rfc7951')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleDecode = async () => {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const payload = inputFormat === 'hex'
        ? { cbor: cborInput, format: outputFormat }
        : { cborBase64: cborInput, format: outputFormat }

      const response = await axios.post('/api/decode', payload)
      setResult(response.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Decode (CBOR to YAML)</h1>
        <p className="page-description">Convert CBOR binary to YAML configuration (offline)</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Input (CBOR)</h2>
        </div>

        <div className="form-row" style={{ marginBottom: '16px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Input Format</label>
            <select
              className="form-select"
              value={inputFormat}
              onChange={(e) => setInputFormat(e.target.value)}
            >
              <option value="hex">Hexadecimal</option>
              <option value="base64">Base64</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Output Format</label>
            <select
              className="form-select"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value)}
            >
              <option value="rfc7951">RFC 7951 (Tree)</option>
              <option value="instance-identifier">Instance Identifier</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <textarea
            className="form-textarea"
            value={cborInput}
            onChange={(e) => setCborInput(e.target.value)}
            rows={6}
            placeholder={inputFormat === 'hex' ? 'Enter CBOR hex string...' : 'Enter CBOR base64 string...'}
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleDecode}
          disabled={loading || !cborInput.trim()}
        >
          {loading ? 'Decoding...' : 'Decode to YAML'}
        </button>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}

      {result && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Result</h2>
            <span className="status-badge success">Decoded</span>
          </div>

          <div className="result-container">
            <div className="result-header">
              <span className="result-title">YAML Output ({result.format})</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                onClick={() => copyToClipboard(result.yaml)}
              >
                Copy
              </button>
            </div>
            <div className="result-content">
              <pre>{result.yaml}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Decode
