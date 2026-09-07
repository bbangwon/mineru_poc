import React, { useState, useEffect } from 'react';
import type { QdrantConfig, QdrantTestResponse } from '../types';
import { getQdrantConfig, saveQdrantConfig, testQdrantConnection } from '../api/client';

interface QdrantConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (cfg: QdrantConfig) => void;
}

export const QdrantConfigModal: React.FC<QdrantConfigModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [config, setConfig] = useState<QdrantConfig>({
    mode: 'embedded',
    local_path: 'output/qdrant_db',
    url: 'http://localhost:6333',
    api_key: '',
    collection_name: 'mineru_chunks',
    recreate_collection: false,
    dense_model_name: 'dragonkue/BGE-m3-ko',
    dense_dim: 1024,
    batch_size: 16,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<QdrantTestResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen]);

  const loadConfig = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setTestResult(null);
    try {
      const data = await getQdrantConfig();
      setConfig(data);
    } catch (err: any) {
      setErrorMsg(err.message || '설정을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await testQdrantConnection({
        mode: config.mode,
        local_path: config.local_path,
        url: config.url,
        api_key: config.api_key,
      });
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        mode: config.mode,
        target: config.mode === 'embedded' ? config.local_path : config.url || '',
        message: err.message || '연결 실패',
        error: err.message,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await saveQdrantConfig(config);
      setSuccessMsg('Qdrant 설정이 성공적으로 저장되었습니다.');
      if (onSaved) onSaved(res.config);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMsg(err.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Qdrant 벡터 DB 연동 설정</h2>
              <p className="text-xs text-slate-400">한국어 BGE-m3 Dense & Kiwi Modifier.IDF Sparse 연동</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 폼 */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* 메시지 알림 */}
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-400">
              {successMsg}
            </div>
          )}

          {/* 실행 모드 선택 */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">Qdrant 실행 모드</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'embedded' })}
                className={`p-3.5 rounded-xl border text-left flex flex-col transition ${
                  config.mode === 'embedded'
                    ? 'bg-indigo-600/20 border-indigo-500 text-slate-100 shadow-sm'
                    : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1">
                  <span>🖥️ 로컬 내장 모드</span>
                  {config.mode === 'embedded' && (
                    <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">활성</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
                  서버 구동 없이 파일 DB로 즉시 인덱싱 및 테스트
                </span>
              </button>

              <button
                type="button"
                onClick={() => setConfig({ ...config, mode: 'remote' })}
                className={`p-3.5 rounded-xl border text-left flex flex-col transition ${
                  config.mode === 'remote'
                    ? 'bg-indigo-600/20 border-indigo-500 text-slate-100 shadow-sm'
                    : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-sm mb-1">
                  <span>🌐 원격 서버 모드</span>
                  {config.mode === 'remote' && (
                    <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded">활성</span>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
                  Docker 인스턴스 또는 Qdrant Cloud 클러스터 연결
                </span>
              </button>
            </div>
          </div>

          {/* 모드별 세부 입력 */}
          {config.mode === 'embedded' ? (
            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 space-y-2">
              <label className="block text-xs font-medium text-slate-300">로컬 스토리지 경로</label>
              <input
                type="text"
                value={config.local_path}
                onChange={(e) => setConfig({ ...config, local_path: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                placeholder="output/qdrant_db"
              />
              <p className="text-[11px] text-slate-400">프로젝트 루트 기준 상대 경로 또는 절대 경로 지정</p>
            </div>
          ) : (
            <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Qdrant 서버 URL</label>
                <input
                  type="text"
                  value={config.url || ''}
                  onChange={(e) => setConfig({ ...config, url: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="http://localhost:6333 또는 https://xxx.cloud.qdrant.io:6333"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">API Key (선택)</label>
                <input
                  type="password"
                  value={config.api_key || ''}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder="API 키가 필요한 경우 입력"
                />
              </div>
            </div>
          )}

          {/* 연결 테스트 버튼 & 결과 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">인스턴스 연결 상태 확인</span>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-medium text-slate-200 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>확인 중...</span>
                  </>
                ) : (
                  <>
                    <span>🔌 연결 테스트</span>
                  </>
                )}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs border ${
                  testResult.success
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <span>{testResult.success ? '✅' : '❌'}</span>
                  <span>{testResult.message}</span>
                </div>
                {testResult.success && testResult.collections && (
                  <div className="mt-1 text-[11px] text-emerald-400/80">
                    기존 컬렉션: {testResult.collections.length > 0 ? testResult.collections.join(', ') : '없음 (새로 생성 예정)'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 컬렉션 설정 */}
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <h3 className="text-xs font-semibold text-slate-300">컬렉션 및 인덱싱 정책</h3>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">대상 컬렉션 이름</label>
              <input
                type="text"
                value={config.collection_name}
                onChange={(e) => setConfig({ ...config, collection_name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                placeholder="mineru_chunks"
              />
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={config.recreate_collection}
                onChange={(e) => setConfig({ ...config, recreate_collection: e.target.checked })}
                className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
              />
              <span className="text-xs text-slate-300">
                인덱싱 실행 시 기존 컬렉션을 초기화하고 새로 생성 (Recreate)
              </span>
            </label>
          </div>

          {/* 임베딩 사양 요약 안내 배너 */}
          <div className="p-3 bg-indigo-950/30 border border-indigo-500/20 rounded-xl space-y-1">
            <div className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1">
              <span>⚡ 하이브리드 인코딩 사양</span>
            </div>
            <div className="text-[11px] text-slate-400 leading-relaxed">
              • <strong>Dense</strong>: {config.dense_model_name} ({config.dense_dim}차원, Mac MPS/CUDA 가속)<br />
              • <strong>Sparse</strong>: Kiwi 형태소 + 결정론적 SHA256 uint32 + Qdrant Modifier.IDF (서버사이드 실시간 IDF 자동 계산)
            </div>
          </div>
        </div>

        {/* 푸터 액션 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isLoading}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
          >
            {isLoading ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </div>
    </div>
  );
};
